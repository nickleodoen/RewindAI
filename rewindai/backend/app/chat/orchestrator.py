"""Chat orchestrator — Claude API with compaction interception."""

import logging
import uuid

import anthropic

from app.config import settings
from app.graph.neo4j_client import get_driver
from app.graph import queries
from app.compaction.interceptor import handle_compaction_event

logger = logging.getLogger(__name__)


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


async def chat(
    session_id: str,
    user_message: str,
    branch_name: str = "main",
    user_id: str = "default",
) -> dict:
    """Send a message in a session, handling compaction if it occurs.

    Returns dict with: response, compaction_occurred, memories_extracted
    """
    driver = await get_driver()

    # 1. Store user turn
    turn_id = str(uuid.uuid4())
    async with driver.session() as session:
        await session.run(
            queries.STORE_TURN,
            turnId=turn_id,
            sessionId=session_id,
            role="user",
            content=user_message,
            branchName=branch_name,
        )

    # 2. Load session history for Claude API
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

    # 3. Call Claude API with compaction enabled
    compaction_occurred = False
    memories_extracted = 0
    assistant_text = ""

    if not settings.anthropic_api_key or settings.anthropic_api_key == "your_key_here":
        # Mock mode — no API key configured
        assistant_text = f"[Mock] I received your message: '{user_message[:100]}'. Claude API is not configured — set ANTHROPIC_API_KEY in .env to enable real responses."
        logger.warning("Chat in mock mode — no ANTHROPIC_API_KEY configured")
    else:
        try:
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            response = _make_claude_request(client, messages)

            # 4. Handle compaction if it occurred
            if response.stop_reason == "compaction":
                compaction_occurred = True
                compaction_block = response.content[0]
                compaction_content = compaction_block.text if hasattr(compaction_block, "text") else str(compaction_block)

                pre_compaction_messages = messages[:]

                memories_extracted = await handle_compaction_event(
                    driver=driver,
                    session_id=session_id,
                    branch_name=branch_name,
                    user_id=user_id,
                    compaction_content=compaction_content,
                    pre_compaction_messages=pre_compaction_messages,
                    token_count=response.usage.input_tokens if response.usage else 0,
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
            assistant_text = f"[API Error] {e.message if hasattr(e, 'message') else str(e)}"
        except anthropic.AuthenticationError as e:
            logger.error("Claude API auth error: %s", e)
            assistant_text = "[API Error] Authentication failed. Check your ANTHROPIC_API_KEY."
        except Exception as e:
            logger.error("Claude API unexpected error: %s", e)
            assistant_text = f"[API Error] {str(e)}"

    # 5. Store assistant turn
    assistant_turn_id = str(uuid.uuid4())
    async with driver.session() as session:
        await session.run(
            queries.STORE_TURN,
            turnId=assistant_turn_id,
            sessionId=session_id,
            role="assistant",
            content=assistant_text,
            branchName=branch_name,
        )

    return {
        "response": assistant_text,
        "compaction_occurred": compaction_occurred,
        "memories_extracted": memories_extracted,
    }
