"""Chat orchestrator — Claude API with compaction interception."""

import logging
import re
import uuid

import anthropic

from app.config import settings
from app.graph.neo4j_client import get_driver
from app.graph import queries
from app.compaction.interceptor import handle_compaction_event
from app.services.workspace_service import get_branch_info, get_memories_at_commit

logger = logging.getLogger(__name__)

STOP_WORDS = {
    "about",
    "after",
    "again",
    "been",
    "from",
    "have",
    "that",
    "their",
    "there",
    "they",
    "this",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would",
    "your",
    "into",
    "than",
    "them",
    "then",
    "were",
    "will",
    "just",
    "some",
    "made",
}

TOKEN_PATTERN = re.compile(r"[A-Za-z0-9+#./-]+")


def _make_claude_request(client: anthropic.Anthropic, messages: list[dict]):
    """Make Claude API request with compaction enabled."""
    return client.beta.messages.create(
        betas=["compact-2026-01-12"],
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=messages,
        context_management={
            "edits": [{
                "type": "compact_20260112",
                "trigger": {"type": "input_tokens", "value": settings.compaction_threshold},
                "pause_after_compaction": True,
                "instructions": "Preserve: decisions+rationale, facts, open questions, action items, dependencies.",
            }]
        },
    )


def _tokenize(text: str) -> list[str]:
    tokens = {
        token.lower().strip("._-/")
        for token in TOKEN_PATTERN.findall(text)
        if len(token.strip("._-/")) > 2
    }
    return sorted(token for token in tokens if token not in STOP_WORDS)


def _score_memory(memory: dict, tokens: list[str]) -> int:
    haystack = f"{memory.get('type', '')} {memory.get('content', '')} {' '.join(memory.get('tags', []))}".lower()
    score = 0

    for token in tokens:
        if token in memory.get("type", "").lower():
            score += 4
        if any(token in tag.lower() for tag in memory.get("tags", [])):
            score += 5
        if token in haystack:
            score += 2

    if "decision" in tokens and memory.get("type") == "decision":
        score += 4
    if "fact" in tokens and memory.get("type") == "fact":
        score += 3
    if {"action", "todo"} & set(tokens) and memory.get("type") == "action_item":
        score += 3
    if {"question", "open"} & set(tokens) and memory.get("type") == "question":
        score += 3

    return score


def _format_type_label(value: str) -> str:
    return value.replace("_", " ").title()


def _build_fallback_response(prompt: str, memories: list[dict], branch_name: str, *, response_mode: str) -> tuple[str, str | None]:
    tokens = _tokenize(prompt)
    ranked = sorted(
        (
            {
                "memory": memory,
                "score": _score_memory(memory, tokens),
            }
            for memory in memories
        ),
        key=lambda item: (item["score"], item["memory"].get("created_at") or ""),
        reverse=True,
    )

    selected = [entry["memory"] for entry in ranked if entry["score"] > 0][:5]
    if not selected:
        by_recency = sorted(memories, key=lambda memory: memory.get("created_at") or "", reverse=True)
        selected = [memory for memory in by_recency if memory.get("type") == "decision"][:3]
        extra = next(
            (memory for memory in by_recency if memory.get("type") in {"action_item", "question"}),
            None,
        )
        if extra and extra not in selected:
            selected.append(extra)

    if selected:
        lines = []
        for memory in selected:
            tags = f" [{', '.join(memory.get('tags', []))}]" if memory.get("tags") else ""
            lines.append(f"- {_format_type_label(memory.get('type', 'fact'))}: {memory.get('content', '')}{tags}")
        response = f"Memory-grounded demo reply from {branch_name}.\n\n" + "\n".join(lines)
    else:
        response = f"Memory-grounded demo reply from {branch_name}.\n\n- No stored memories match that question yet on this branch."

    if response_mode == "mock":
        notice = "Live AI is not configured. Showing a memory-grounded demo fallback."
    else:
        notice = "Live AI is temporarily unavailable. Showing a memory-grounded demo fallback."

    return response, notice


async def _resolve_fallback_memories(
    driver,
    *,
    session_node,
    session_branch_name: str,
    user_id: str,
) -> tuple[list[dict], str]:
    origin_commit_id = session_node.get("originCommitId")
    origin_branch = session_node.get("originBranch") or session_branch_name
    commit_id = origin_commit_id

    if not commit_id and session_branch_name:
        branch = await get_branch_info(driver, session_branch_name)
        if branch:
            commit_id = branch.get("head_commit_id")
            origin_branch = branch.get("name") or origin_branch

    memories = await get_memories_at_commit(driver, commit_id)
    if not memories:
        status_branch = await get_branch_info(driver, origin_branch) if origin_branch else None
        if status_branch and status_branch.get("head_commit_id") and status_branch.get("head_commit_id") != commit_id:
            memories = await get_memories_at_commit(driver, status_branch.get("head_commit_id"))

    return memories, origin_branch or session_branch_name or user_id


async def chat(
    session_id: str,
    user_message: str,
    user_id: str = "default",
) -> dict:
    """Send a message in a session, handling compaction if it occurs.

    Returns dict with: response, compaction_occurred, memories_extracted
    """
    driver = await get_driver()

    # 1. Resolve session context
    session_branch_name = "main"
    checkout_mode = "attached"
    session_node = None
    async with driver.session() as session:
        result = await session.run(queries.GET_SESSION, sessionId=session_id)
        record = await result.single()
        if not record:
            raise ValueError(f"Session '{session_id}' not found")
        session_node = record["s"]
        session_branch_name = session_node.get("branchName", "main")
        checkout_mode = session_node.get("checkoutMode", "attached")

    # 2. Store user turn
    turn_id = str(uuid.uuid4())
    async with driver.session() as session:
        await session.run(
            queries.STORE_TURN,
            turnId=turn_id,
            sessionId=session_id,
            role="user",
            content=user_message,
            branchName=session_branch_name,
        )

    # 3. Load session history for Claude API
    messages = []
    async with driver.session() as session:
        result = await session.run(queries.GET_SESSION_TURNS, sessionId=session_id)
        records = await result.data()
        for record in records:
            ct = record["ct"]
            messages.append({
                "role": ct["role"],
                "content": ct["content"],
            })

    # 4. Call Claude API with compaction enabled
    compaction_occurred = False
    memories_extracted = 0
    assistant_text = ""
    response_mode = "live"
    notice = None

    if not settings.anthropic_api_key or settings.anthropic_api_key == "your_key_here":
        response_mode = "mock"
        logger.warning("Chat in mock mode — no ANTHROPIC_API_KEY configured")
    else:
        try:
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            response = _make_claude_request(client, messages)

            # 5. Handle compaction if it occurred
            if response.stop_reason == "compaction":
                compaction_occurred = True
                compaction_block = response.content[0]
                compaction_content = compaction_block.text if hasattr(compaction_block, "text") else str(compaction_block)

                pre_compaction_messages = messages[:]

                memories_extracted = await handle_compaction_event(
                    driver=driver,
                    session_id=session_id,
                    branch_name=session_branch_name,
                    user_id=user_id,
                    compaction_content=compaction_content,
                    pre_compaction_messages=pre_compaction_messages,
                    token_count=response.usage.input_tokens if response.usage else 0,
                    persist_memories=checkout_mode != "detached",
                )

                # Continue session with compacted context
                compacted_messages = [{"role": "assistant", "content": [compaction_block]}]
                compacted_messages.append({"role": "user", "content": user_message})

                continuation = _make_claude_request(client, compacted_messages)
                assistant_text = continuation.content[0].text if continuation.content else ""
            else:
                assistant_text = response.content[0].text if response.content else ""

        except anthropic.BadRequestError as e:
            logger.error("Claude API error: %s", e)
            response_mode = "fallback"
        except anthropic.AuthenticationError as e:
            logger.error("Claude API auth error: %s", e)
            response_mode = "fallback"
        except Exception as e:
            logger.error("Claude API unexpected error: %s", e)
            response_mode = "fallback"

    if response_mode != "live":
        fallback_memories, fallback_branch = await _resolve_fallback_memories(
            driver,
            session_node=session_node,
            session_branch_name=session_branch_name,
            user_id=user_id,
        )
        assistant_text, notice = _build_fallback_response(
            user_message,
            fallback_memories,
            fallback_branch,
            response_mode=response_mode,
        )

    # 6. Store assistant turn
    assistant_turn_id = str(uuid.uuid4())
    async with driver.session() as session:
        await session.run(
            queries.STORE_TURN,
            turnId=assistant_turn_id,
            sessionId=session_id,
            role="assistant",
            content=assistant_text,
            branchName=session_branch_name,
        )

    return {
        "response": assistant_text,
        "compaction_occurred": compaction_occurred,
        "memories_extracted": memories_extracted,
        "response_mode": response_mode,
        "notice": notice,
    }
