"""Workspace, HEAD, and ref-aware history services."""

from __future__ import annotations

import re
import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from neo4j import AsyncDriver

from app.chat.context_builder import build_context_for_checkout
from app.compaction.extractor import extract_memories
from app.graph import queries


MEMORY_TYPE_LABELS = {
    "decision": "decision",
    "fact": "fact",
    "context": "context",
    "action_item": "action item",
    "question": "question",
}

STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "our",
    "that",
    "the",
    "this",
    "to",
    "use",
    "using",
    "we",
    "with",
}

TECH_TOKENS = {
    "rest",
    "graphql",
    "jwt",
    "neo4j",
    "apollo",
    "tanstack",
    "fastapi",
    "react",
    "redis",
    "postgres",
    "postgresql",
    "oauth",
    "grpc",
    "claude",
    "anthropic",
    "vite",
    "typescript",
    "python",
}

TOKEN_PATTERN = re.compile(r"[A-Za-z0-9+#./-]+")


def _dt(val) -> str | None:
    """Convert Neo4j DateTime to ISO string."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    if hasattr(val, "to_native"):
        return val.to_native().isoformat()
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)


def _normalize_text(text: str) -> str:
    tokens = []
    for raw in TOKEN_PATTERN.findall(text.lower()):
        token = raw.strip("._-/")
        if not token or token in STOPWORDS:
            continue
        tokens.append(token)
    return " ".join(tokens)


def _extract_tokens(text: str) -> set[str]:
    tokens: set[str] = set()
    for raw in TOKEN_PATTERN.findall(text):
        token = raw.lower().strip("._-/")
        if not token:
            continue
        if token in TECH_TOKENS or (len(token) > 2 and token not in STOPWORDS):
            tokens.add(token)
    return tokens


def _memory_identity(memory: dict[str, Any]) -> tuple[str, str]:
    return (memory.get("type", "fact"), _normalize_text(memory.get("content", "")))


def _dedupe_memories(memories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str], dict[str, Any]] = {}
    for memory in sorted(memories, key=lambda item: (item.get("created_at") or "", item.get("id") or "")):
        deduped.setdefault(_memory_identity(memory), memory)
    return list(deduped.values())


def _memory_topic_tokens(memory: dict[str, Any]) -> set[str]:
    tokens = _extract_tokens(memory.get("content", ""))
    for tag in memory.get("tags", []) or []:
        tokens.update(_extract_tokens(tag))
    return tokens


def _memory_similarity(memory_a: dict[str, Any], memory_b: dict[str, Any]) -> tuple[bool, str, int]:
    if memory_a.get("type") != memory_b.get("type"):
        return False, "", 0
    if _memory_identity(memory_a) == _memory_identity(memory_b):
        return False, "", 0

    tags_a = {tag.lower() for tag in (memory_a.get("tags") or [])}
    tags_b = {tag.lower() for tag in (memory_b.get("tags") or [])}
    shared_tags = tags_a & tags_b
    tokens_a = _memory_topic_tokens(memory_a)
    tokens_b = _memory_topic_tokens(memory_b)
    shared_tokens = tokens_a & tokens_b
    union_tokens = tokens_a | tokens_b
    overlap_ratio = (len(shared_tokens) / len(union_tokens)) if union_tokens else 0.0

    strong_overlap = bool(shared_tags) or len(shared_tokens) >= 2 or overlap_ratio >= 0.34
    if not strong_overlap:
        return False, "", 0

    reasons = []
    if shared_tags:
        reasons.append(f"shared tags: {', '.join(sorted(shared_tags))}")
    tech_overlap = sorted(token for token in shared_tokens if token in TECH_TOKENS)
    if tech_overlap:
        reasons.append(f"shared entities: {', '.join(tech_overlap)}")
    if not reasons:
        reasons.append(f"token overlap {overlap_ratio:.2f}")

    score = len(shared_tags) * 100 + len(tech_overlap) * 10 + len(shared_tokens)
    return True, "; ".join(reasons), score


def _serialize_commit_node(commit, parents: list[dict[str, Any]] | None = None) -> dict:
    parent_ids = [parent["id"] for parent in (parents or []) if parent]
    if not parent_ids and commit.get("parentIds"):
        parent_ids = list(commit.get("parentIds"))
    is_merge = bool(commit.get("isMerge")) or len(parent_ids) > 1
    return {
        "id": commit["id"],
        "message": commit.get("message", ""),
        "summary": commit.get("summary"),
        "memory_delta_count": int(commit.get("memoryDeltaCount", 0) or 0),
        "branch_name": commit.get("branchName", ""),
        "user_id": commit.get("userId"),
        "created_at": _dt(commit.get("createdAt")),
        "parent_id": parent_ids[0] if parent_ids else None,
        "parent_ids": parent_ids,
        "is_merge": is_merge,
        "merge_strategy": commit.get("mergeStrategy"),
        "merged_from_branch": commit.get("mergedFromBranch"),
        "merge_base_commit_id": commit.get("mergeBaseCommitId"),
        "conflicts_resolved": int(commit.get("conflictsResolved", 0) or 0),
    }


def _serialize_memory_node(memory) -> dict:
    return {
        "id": memory["id"],
        "type": memory.get("type", "fact"),
        "content": memory.get("content", ""),
        "branch_name": memory.get("branchName", ""),
        "tags": memory.get("tags", []),
        "user_id": memory.get("userId"),
        "created_at": _dt(memory.get("createdAt")),
    }


def _merge_commit_summary(source_branch: str, target_branch: str, auto_merged_count: int, conflicts_resolved: int) -> str:
    return (
        f"Merged {source_branch} into {target_branch} "
        f"({auto_merged_count} auto-merged, {conflicts_resolved} conflicts resolved)"
    )


def _timestamp_sort_value(value: str | None) -> float:
    if not value:
        return 0.0
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _memory_breakdown(memories: list[dict]) -> dict[str, int]:
    counts = Counter(memory.get("type", "fact") for memory in memories)
    return dict(sorted(counts.items()))


def _truncate_phrase(text: str, limit: int = 48) -> str:
    if len(text) <= limit:
        return text
    truncated = text[: limit - 1].rstrip(" ,;:-")
    return f"{truncated}..."


def _normalize_summary_fragment(text: str) -> str:
    cleaned = text.strip().rstrip(".")
    if not cleaned:
        return ""
    lowered = cleaned.lower()
    prefixes = [
        "using ",
        "use ",
        "chosen ",
        "choosing ",
        "decided ",
        "decision ",
        "we will ",
        "we're ",
        "explore ",
        "explored ",
        "set up ",
        "define ",
    ]
    for prefix in prefixes:
        if lowered.startswith(prefix):
            cleaned = cleaned[len(prefix):]
            break
    return _truncate_phrase(cleaned)


def _generate_commit_summary(message: str, memories: list[dict]) -> str:
    if not memories:
        return message.strip() or "Snapshot of current memory state"

    prioritized = sorted(
        memories,
        key=lambda memory: (
            {"decision": 0, "action_item": 1, "question": 2, "fact": 3, "context": 4}.get(memory.get("type", "fact"), 5),
            memory.get("created_at") or "",
        ),
    )
    fragments = []
    for memory in prioritized:
        fragment = _normalize_summary_fragment(memory.get("content", ""))
        if fragment and fragment not in fragments:
            fragments.append(fragment)
        if len(fragments) == 2:
            break

    if fragments:
        if len(fragments) == 1:
            return f"Captured {fragments[0]}"
        return f"Captured {fragments[0]} and {fragments[1]}"

    counts = Counter(memory.get("type", "fact") for memory in memories)
    parts = []
    for mem_type in ("decision", "fact", "action_item", "question", "context"):
        count = counts.get(mem_type)
        if count:
            label = MEMORY_TYPE_LABELS[mem_type]
            parts.append(f"{count} {label}{'' if count == 1 else 's'}")
    summary = ", ".join(parts[:3]) if parts else "current memory changes"
    return f"Captured {summary}"


async def ensure_workspace(driver: AsyncDriver, user_id: str) -> None:
    async with driver.session() as session:
        await session.run(queries.ENSURE_USER, userId=user_id, userName=user_id)
        await session.run(queries.ENSURE_WORKSPACE, userId=user_id)


async def get_workspace_record(driver: AsyncDriver, user_id: str) -> dict | None:
    async with driver.session() as session:
        result = await session.run(queries.GET_WORKSPACE, userId=user_id)
        record = await result.single()
        if not record:
            return None

        workspace = record["w"]
        branch = record.get("b")
        commit = record.get("c")
        active_session = record.get("s")
        return {
            "user_id": workspace.get("userId", user_id),
            "mode": workspace.get("mode", "attached"),
            "branch_name": branch["name"] if branch else None,
            "head_commit_id": commit["id"] if commit else None,
            "session_id": active_session["id"] if active_session else None,
            "origin_branch": workspace.get("originBranch"),
            "origin_commit_id": workspace.get("originCommitId"),
            "workspace_updated_at": _dt(workspace.get("updatedAt")),
            "session": active_session,
        }


async def get_session_info(driver: AsyncDriver, session_id: str) -> dict | None:
    async with driver.session() as session:
        result = await session.run(queries.GET_SESSION, sessionId=session_id)
        record = await result.single()
        if not record:
            return None
        s = record["s"]
        return {
            "id": s["id"],
            "branch_name": s.get("branchName", ""),
            "user_id": s.get("userId"),
            "origin_commit_id": s.get("originCommitId"),
            "origin_branch": s.get("originBranch"),
            "checkout_mode": s.get("checkoutMode"),
            "reconstructed_at": _dt(s.get("reconstructedAt")),
            "last_committed_at": _dt(s.get("lastCommittedAt")),
            "created_at": _dt(s.get("createdAt")),
        }


async def get_branch_info(driver: AsyncDriver, branch_name: str) -> dict | None:
    async with driver.session() as session:
        result = await session.run(queries.GET_BRANCH, branchName=branch_name)
        record = await result.single()
        if not record:
            return None
        branch = record["b"]
        head = record.get("head")
        branched_from = record.get("branchedFrom")
        return {
            "name": branch["name"],
            "created_at": _dt(branch.get("createdAt")),
            "created_by": branch.get("createdBy"),
            "head_commit_id": head["id"] if head else None,
            "head_message": head.get("message") if head else None,
            "branched_from_commit_id": branched_from["id"] if branched_from else None,
        }


async def get_commit_info(driver: AsyncDriver, ref: str) -> dict | None:
    async with driver.session() as session:
        result = await session.run(queries.GET_COMMIT, commitId=ref)
        record = await result.single()
        if record:
            commit = record["c"]
            branch = record.get("b")
            parents = record.get("parents", [])
            return {
                **_serialize_commit_node(commit, parents),
                "branch_name": branch["name"] if branch else commit.get("branchName", ""),
            }

        prefix_result = await session.run(queries.GET_COMMIT_BY_PREFIX, ref=ref)
        prefix_records = await prefix_result.data()
        if not prefix_records:
            return None
        if len(prefix_records) > 1:
            raise ValueError(f"Ambiguous commit ref '{ref}'")

        record = prefix_records[0]
        commit = record["c"]
        branch = record.get("b")
        parents = record.get("parents", [])
        return {
            **_serialize_commit_node(commit, parents),
            "branch_name": branch["name"] if branch else commit.get("branchName", ""),
        }


async def resolve_ref(driver: AsyncDriver, ref: str, user_id: str = "default") -> dict:
    if ref == "HEAD":
        workspace = await get_workspace_record(driver, user_id)
        if not workspace or (not workspace.get("head_commit_id") and not workspace.get("branch_name")):
            raise ValueError("No active workspace HEAD. Run checkout first.")
        if workspace.get("branch_name") and workspace.get("mode") == "attached":
            branch = await get_branch_info(driver, workspace["branch_name"])
            if branch:
                return {
                    "kind": "branch",
                    "label": "HEAD",
                    "branch_name": branch["name"],
                    "commit_id": branch.get("head_commit_id"),
                    "message": branch.get("head_message"),
                }
        commit_id = workspace.get("head_commit_id")
        if not commit_id:
            raise ValueError("Workspace HEAD is not pointing at a commit.")
        commit = await get_commit_info(driver, commit_id)
        if not commit:
            raise ValueError("Workspace HEAD commit could not be resolved.")
        return {
            "kind": "commit",
            "label": "HEAD",
            "branch_name": commit.get("branch_name"),
            "commit_id": commit["id"],
            "message": commit.get("message"),
        }

    branch = await get_branch_info(driver, ref)
    if branch:
        return {
            "kind": "branch",
            "label": ref,
            "branch_name": branch["name"],
            "commit_id": branch.get("head_commit_id"),
            "message": branch.get("head_message"),
        }

    commit = await get_commit_info(driver, ref)
    if commit:
        return {
            "kind": "commit",
            "label": ref,
            "branch_name": commit.get("branch_name"),
            "commit_id": commit["id"],
            "message": commit.get("message"),
        }

    raise ValueError(f"Unknown ref '{ref}'")


async def get_memories_at_commit(driver: AsyncDriver, commit_id: str | None) -> list[dict]:
    if not commit_id:
        return []
    async with driver.session() as session:
        result = await session.run(queries.MEMORIES_AT_COMMIT, commitId=commit_id)
        records = await result.data()
        memories = [_serialize_memory_node(record["m"]) for record in records]
    return _dedupe_memories(memories)


async def get_ancestors(driver: AsyncDriver, commit_id: str | None) -> dict[str, dict]:
    if not commit_id:
        return {}
    async with driver.session() as session:
        result = await session.run(queries.GET_COMMIT_ANCESTORS, commitId=commit_id)
        records = await result.data()

    ancestors: dict[str, dict] = {}
    for record in records:
        commit = record["c"]
        serialized = _serialize_commit_node(commit)
        serialized["depth"] = int(record.get("depth", 0) or 0)
        ancestors[serialized["id"]] = serialized
    return ancestors


async def get_common_ancestors(driver: AsyncDriver, commit_a: str | None, commit_b: str | None) -> list[dict]:
    ancestors_a = await get_ancestors(driver, commit_a)
    ancestors_b = await get_ancestors(driver, commit_b)
    common_ids = ancestors_a.keys() & ancestors_b.keys()

    common = []
    for commit_id in common_ids:
        entry = dict(ancestors_a[commit_id])
        entry["depth_a"] = ancestors_a[commit_id]["depth"]
        entry["depth_b"] = ancestors_b[commit_id]["depth"]
        common.append(entry)
    return common


async def find_merge_base(driver: AsyncDriver, commit_a: str | None, commit_b: str | None) -> dict | None:
    common = await get_common_ancestors(driver, commit_a, commit_b)
    if not common:
        return None
    common.sort(
        key=lambda entry: (
            entry["depth_a"] + entry["depth_b"],
            max(entry["depth_a"], entry["depth_b"]),
            -_timestamp_sort_value(entry.get("created_at")),
        )
    )
    return common[0]


def _snapshot_index(memories: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    return {_memory_identity(memory): memory for memory in memories}


def _snapshot_delta(base_snapshot: list[dict[str, Any]], current_snapshot: list[dict[str, Any]]) -> list[dict[str, Any]]:
    base_index = _snapshot_index(base_snapshot)
    current_index = _snapshot_index(current_snapshot)
    return [memory for key, memory in current_index.items() if key not in base_index]


def _detect_conflicts(target_delta: list[dict[str, Any]], source_delta: list[dict[str, Any]]) -> tuple[list[dict], list[dict]]:
    candidates = []
    for memory_a in target_delta:
        for memory_b in source_delta:
            is_conflict, reason, score = _memory_similarity(memory_a, memory_b)
            if is_conflict:
                candidates.append((score, memory_a, memory_b, reason))

    candidates.sort(key=lambda entry: (-entry[0], entry[1]["id"], entry[2]["id"]))

    matched_target_ids: set[str] = set()
    matched_source_ids: set[str] = set()
    conflicts: list[dict] = []
    for _, memory_a, memory_b, reason in candidates:
        if memory_a["id"] in matched_target_ids or memory_b["id"] in matched_source_ids:
            continue
        matched_target_ids.add(memory_a["id"])
        matched_source_ids.add(memory_b["id"])
        conflicts.append({"memory_a": memory_a, "memory_b": memory_b, "reason": reason})

    auto_merged = [memory for memory in source_delta if memory["id"] not in matched_source_ids]
    return conflicts, auto_merged


async def create_session_with_context(
    driver: AsyncDriver,
    *,
    branch_name: str,
    user_id: str,
    checkout_mode: str,
    origin_commit_id: str | None,
    origin_branch: str | None,
    context_messages: list[dict] | None = None,
    reconstructed_at: str | None = None,
) -> dict:
    session_id = str(uuid.uuid4())
    await ensure_workspace(driver, user_id)

    async with driver.session() as session:
        result = await session.run(
            queries.CREATE_SESSION,
            sessionId=session_id,
            branchName=branch_name,
            userId=user_id,
            originCommitId=origin_commit_id,
            originBranch=origin_branch,
            checkoutMode=checkout_mode,
            reconstructedAt=reconstructed_at,
        )
        record = await result.single()
        created = record["s"]

    if context_messages:
        async with driver.session() as session:
            for message in context_messages:
                await session.run(
                    queries.STORE_TURN,
                    turnId=str(uuid.uuid4()),
                    sessionId=session_id,
                    role=message["role"],
                    content=message["content"],
                    branchName=branch_name,
                )
            await session.run(queries.MARK_SESSION_COMMITTED, sessionId=session_id)

    return {
        "id": created["id"],
        "branch_name": created.get("branchName", branch_name),
        "user_id": created.get("userId", user_id),
        "created_at": _dt(created.get("createdAt")),
        "origin_commit_id": created.get("originCommitId"),
        "origin_branch": created.get("originBranch"),
        "checkout_mode": created.get("checkoutMode"),
        "reconstructed_at": _dt(created.get("reconstructedAt")),
    }


async def update_session_metadata(
    driver: AsyncDriver,
    *,
    session_id: str,
    branch_name: str,
    checkout_mode: str,
    origin_commit_id: str | None,
    origin_branch: str | None,
    reconstructed_at: str | None = None,
) -> None:
    async with driver.session() as session:
        await session.run(
            queries.UPDATE_SESSION_METADATA,
            sessionId=session_id,
            branchName=branch_name,
            originCommitId=origin_commit_id,
            originBranch=origin_branch,
            checkoutMode=checkout_mode,
            reconstructedAt=reconstructed_at,
        )


async def set_workspace_state(
    driver: AsyncDriver,
    *,
    user_id: str,
    mode: str,
    branch_name: str | None,
    head_commit_id: str | None,
    session_id: str | None,
    origin_branch: str | None,
    origin_commit_id: str | None,
) -> None:
    await ensure_workspace(driver, user_id)
    async with driver.session() as session:
        await session.run(
            queries.SET_WORKSPACE_STATE,
            userId=user_id,
            mode=mode,
            branchName=branch_name,
            headCommitId=head_commit_id,
            sessionId=session_id,
            originBranch=origin_branch,
            originCommitId=origin_commit_id,
        )


async def get_workspace_status(driver: AsyncDriver, user_id: str = "default") -> dict:
    workspace = await get_workspace_record(driver, user_id)
    if not workspace:
        return {
            "user_id": user_id,
            "mode": "uninitialized",
            "branch_name": None,
            "head_commit_id": None,
            "head_message": None,
            "head_summary": None,
            "head_parent_ids": [],
            "head_is_merge": False,
            "session_id": None,
            "origin_branch": None,
            "origin_commit_id": None,
            "reconstructed_at": None,
            "active_memory_count": 0,
            "memory_breakdown": {},
            "summary": "No active workspace. Run checkout to attach to a branch or commit.",
        }

    session_info = None
    if workspace.get("session_id"):
        session_info = await get_session_info(driver, workspace["session_id"])

    head_commit = await get_commit_info(driver, workspace.get("head_commit_id")) if workspace.get("head_commit_id") else None
    memories = await get_memories_at_commit(driver, workspace.get("head_commit_id"))
    branch_name = workspace.get("branch_name")
    if workspace.get("mode") == "detached":
        summary = "Detached historical snapshot loaded"
    elif branch_name:
        summary = f"Attached to branch '{branch_name}'"
    else:
        summary = "Workspace initialized without an attached branch"

    if workspace.get("head_commit_id"):
        summary = f"{summary} at {workspace['head_commit_id'][:8]}"
    if head_commit and head_commit.get("is_merge"):
        summary = f"{summary} (merge HEAD)"

    return {
        "user_id": user_id,
        "mode": workspace.get("mode", "attached"),
        "branch_name": branch_name,
        "head_commit_id": workspace.get("head_commit_id"),
        "head_message": head_commit.get("message") if head_commit else None,
        "head_summary": head_commit.get("summary") if head_commit else None,
        "head_parent_ids": head_commit.get("parent_ids", []) if head_commit else [],
        "head_is_merge": bool(head_commit.get("is_merge")) if head_commit else False,
        "session_id": workspace.get("session_id"),
        "origin_branch": workspace.get("origin_branch"),
        "origin_commit_id": workspace.get("origin_commit_id"),
        "reconstructed_at": session_info.get("reconstructed_at") if session_info else None,
        "active_memory_count": len(memories),
        "memory_breakdown": _memory_breakdown(memories),
        "summary": summary,
    }


async def _build_checkout_payload(driver: AsyncDriver, commit_id: str | None) -> tuple[list[dict], int]:
    if not commit_id:
        return [], 0
    context_messages = await build_context_for_checkout(driver, commit_id)
    memories = await get_memories_at_commit(driver, commit_id)
    return context_messages, len(memories)


async def attach_branch(
    driver: AsyncDriver,
    branch_name: str,
    user_id: str = "default",
    reuse_session: bool = False,
) -> dict:
    branch = await get_branch_info(driver, branch_name)
    if not branch:
        return {"error": f"Unknown branch '{branch_name}'"}

    await ensure_workspace(driver, user_id)
    workspace = await get_workspace_record(driver, user_id)
    head_commit_id = branch.get("head_commit_id")
    context_messages: list[dict] = []
    memory_count = 0

    session_id = None
    if reuse_session and workspace and workspace.get("session_id") and workspace.get("head_commit_id") == head_commit_id:
        session_id = workspace["session_id"]
        await update_session_metadata(
            driver,
            session_id=session_id,
            branch_name=branch_name,
            checkout_mode="attached",
            origin_commit_id=head_commit_id,
            origin_branch=branch_name,
        )
    else:
        if head_commit_id:
            context_messages, memory_count = await _build_checkout_payload(driver, head_commit_id)
        reconstructed_at = datetime.now(timezone.utc).isoformat() if head_commit_id else None
        session = await create_session_with_context(
            driver,
            branch_name=branch_name,
            user_id=user_id,
            checkout_mode="attached",
            origin_commit_id=head_commit_id,
            origin_branch=branch_name,
            context_messages=context_messages,
            reconstructed_at=reconstructed_at,
        )
        session_id = session["id"]

    await set_workspace_state(
        driver,
        user_id=user_id,
        mode="attached",
        branch_name=branch_name,
        head_commit_id=head_commit_id,
        session_id=session_id,
        origin_branch=branch_name,
        origin_commit_id=head_commit_id,
    )

    return {
        "mode": "attached",
        "branch_name": branch_name,
        "commit_id": head_commit_id,
        "session_id": session_id,
        "context_messages": context_messages,
        "memory_count": memory_count,
        "status": await get_workspace_status(driver, user_id),
    }


async def detach_to_commit(
    driver: AsyncDriver,
    commit_ref: str,
    user_id: str = "default",
    reuse_session: bool = False,
) -> dict:
    resolved = await resolve_ref(driver, commit_ref, user_id)
    if resolved["kind"] != "commit":
        return {"error": f"Ref '{commit_ref}' is not a commit"}

    commit_id = resolved["commit_id"]
    branch_name = resolved.get("branch_name")
    await ensure_workspace(driver, user_id)
    workspace = await get_workspace_record(driver, user_id)

    context_messages: list[dict] = []
    memory_count = 0
    session_id = None
    if reuse_session and workspace and workspace.get("session_id") and workspace.get("head_commit_id") == commit_id:
        session_id = workspace["session_id"]
        await update_session_metadata(
            driver,
            session_id=session_id,
            branch_name=branch_name or "main",
            checkout_mode="detached",
            origin_commit_id=commit_id,
            origin_branch=branch_name,
        )
    else:
        context_messages, memory_count = await _build_checkout_payload(driver, commit_id)
        session = await create_session_with_context(
            driver,
            branch_name=branch_name or "main",
            user_id=user_id,
            checkout_mode="detached",
            origin_commit_id=commit_id,
            origin_branch=branch_name,
            context_messages=context_messages,
            reconstructed_at=datetime.now(timezone.utc).isoformat(),
        )
        session_id = session["id"]

    await set_workspace_state(
        driver,
        user_id=user_id,
        mode="detached",
        branch_name=None,
        head_commit_id=commit_id,
        session_id=session_id,
        origin_branch=branch_name,
        origin_commit_id=commit_id,
    )

    return {
        "mode": "detached",
        "branch_name": branch_name,
        "commit_id": commit_id,
        "session_id": session_id,
        "context_messages": context_messages,
        "memory_count": memory_count,
        "status": await get_workspace_status(driver, user_id),
    }


async def checkout_workspace(
    driver: AsyncDriver,
    ref: str,
    user_id: str = "default",
    reuse_session: bool = False,
) -> dict:
    resolved = await resolve_ref(driver, ref, user_id)
    if resolved["kind"] == "branch":
        return await attach_branch(driver, resolved["branch_name"], user_id=user_id, reuse_session=reuse_session)
    return await detach_to_commit(driver, resolved["commit_id"], user_id=user_id, reuse_session=reuse_session)


async def checkout_compat(
    driver: AsyncDriver,
    branch_name: str,
    commit_id: str | None = None,
    user_id: str = "default",
) -> dict:
    if commit_id:
        result = await detach_to_commit(driver, commit_id, user_id=user_id, reuse_session=False)
        if "error" in result:
            return result
        return {
            "session_id": result["session_id"],
            "branch_name": branch_name,
            "commit_id": result["commit_id"],
            "context_messages": result.get("context_messages", []),
            "memory_count": result.get("memory_count", 0),
            "mode": result["mode"],
            "status": result["status"],
        }

    result = await attach_branch(driver, branch_name, user_id=user_id, reuse_session=False)
    if "error" in result:
        return result
    return {
        "session_id": result["session_id"],
        "branch_name": result["branch_name"],
        "commit_id": result["commit_id"],
        "context_messages": result.get("context_messages", []),
        "memory_count": result.get("memory_count", 0),
        "mode": result["mode"],
        "status": result["status"],
    }


async def _extract_new_memories(
    driver: AsyncDriver,
    *,
    session_id: str,
    branch_name: str,
    user_id: str,
    since_iso: str | None,
) -> list[dict]:
    async with driver.session() as session:
        if since_iso:
            result = await session.run(queries.GET_SESSION_TURNS_SINCE, sessionId=session_id, sinceIso=since_iso)
        else:
            result = await session.run(queries.GET_SESSION_TURNS, sessionId=session_id)
        records = await result.data()

    relevant_turns = []
    for record in records:
        turn = record["ct"]
        role = turn.get("role", "")
        content = turn.get("content", "")
        if role not in {"user", "assistant"}:
            continue
        if not content or content.startswith("You are a team AI assistant with versioned memory."):
            continue
        relevant_turns.append({"role": role, "content": content})

    if not relevant_turns:
        return []

    extracted = await extract_memories(
        "\n".join(f"{turn['role']}: {turn['content']}" for turn in relevant_turns)
    )
    if not extracted:
        return []

    created: list[dict] = []
    async with driver.session() as session:
        for memory in extracted:
            fingerprint = await session.run(
                queries.FIND_MEMORY_BY_FINGERPRINT,
                branchName=branch_name,
                type=memory.get("type", "fact"),
                content=memory.get("content", ""),
            )
            if await fingerprint.single():
                continue

            memory_id = memory.get("id") or str(uuid.uuid4())
            result = await session.run(
                queries.STORE_MEMORY,
                memoryId=memory_id,
                type=memory.get("type", "fact"),
                content=memory.get("content", ""),
                tags=memory.get("tags", []),
                branchName=branch_name,
                sessionId=session_id,
                userId=user_id,
            )
            record = await result.single()
            created_memory = _serialize_memory_node(record["m"])
            created.append(created_memory)

            for dep_id in memory.get("depends_on", []):
                try:
                    await session.run(queries.LINK_MEMORY_DEPENDENCY, fromId=memory_id, toId=dep_id)
                except Exception:
                    pass

            for old_id in memory.get("supersedes", []):
                try:
                    await session.run(queries.LINK_MEMORY_SUPERSEDES, newId=memory_id, oldId=old_id)
                except Exception:
                    pass

    return created


async def create_commit_on_branch(
    driver: AsyncDriver,
    branch_name: str,
    message: str,
    user_id: str = "default",
    session_id: str | None = None,
) -> dict:
    branch = await get_branch_info(driver, branch_name)
    if not branch:
        raise ValueError(f"Unknown branch '{branch_name}'")

    workspace = await get_workspace_record(driver, user_id)
    if not session_id and workspace and workspace.get("mode") == "attached" and workspace.get("branch_name") == branch_name:
        session_id = workspace.get("session_id")

    new_memories: list[dict] = []
    if session_id:
        session_info = await get_session_info(driver, session_id)
        if session_info:
            new_memories = await _extract_new_memories(
                driver,
                session_id=session_id,
                branch_name=branch_name,
                user_id=user_id,
                since_iso=session_info.get("last_committed_at"),
            )

    parent_commit_id = branch.get("head_commit_id") or branch.get("branched_from_commit_id")
    commit_id = str(uuid.uuid4())
    summary = _generate_commit_summary(message, new_memories)

    async with driver.session() as session:
        result = await session.run(
            queries.CREATE_COMMIT,
            commitId=commit_id,
            message=message,
            summary=summary,
            memoryDeltaCount=len(new_memories),
            userId=user_id,
            branchName=branch_name,
            parentCommitId=parent_commit_id,
        )
        record = await result.single()
        commit = record["c"]
        parents = record.get("parents", [])
        serialized = _serialize_commit_node(commit, parents)

        if session_id:
            await session.run(queries.MARK_SESSION_COMMITTED, sessionId=session_id)

    if session_id:
        await update_session_metadata(
            driver,
            session_id=session_id,
            branch_name=branch_name,
            checkout_mode="attached",
            origin_commit_id=commit_id,
            origin_branch=branch_name,
        )

    if workspace and workspace.get("mode") == "attached" and workspace.get("branch_name") == branch_name:
        await set_workspace_state(
            driver,
            user_id=user_id,
            mode="attached",
            branch_name=branch_name,
            head_commit_id=commit_id,
            session_id=session_id or workspace.get("session_id"),
            origin_branch=branch_name,
            origin_commit_id=commit_id,
        )

    return serialized


async def commit_workspace(
    driver: AsyncDriver,
    message: str,
    user_id: str = "default",
) -> dict:
    workspace = await get_workspace_record(driver, user_id)
    if not workspace or not workspace.get("session_id"):
        return {"error": "No active workspace. Run checkout first."}
    if workspace.get("mode") == "detached":
        return {"error": "Detached HEAD. Create or checkout a branch before committing."}
    if not workspace.get("branch_name"):
        return {"error": "No attached branch in the active workspace."}

    commit = await create_commit_on_branch(
        driver,
        branch_name=workspace["branch_name"],
        message=message,
        user_id=user_id,
        session_id=workspace.get("session_id"),
    )
    return {
        **commit,
        "status": await get_workspace_status(driver, user_id),
    }


async def get_log(driver: AsyncDriver, ref: str | None = None, user_id: str = "default") -> list[dict]:
    resolved = await resolve_ref(driver, ref or "HEAD", user_id)
    commit_id = resolved.get("commit_id")
    if not commit_id:
        return []
    async with driver.session() as session:
        result = await session.run(queries.GET_COMMIT_LINEAGE, commitId=commit_id)
        records = await result.data()
        return [_serialize_commit_node(record["c"], record.get("parents", [])) for record in records]


async def diff_refs(driver: AsyncDriver, ref_a: str, ref_b: str, user_id: str = "default") -> dict:
    resolved_a = await resolve_ref(driver, ref_a, user_id)
    resolved_b = await resolve_ref(driver, ref_b, user_id)

    memories_a = await get_memories_at_commit(driver, resolved_a.get("commit_id"))
    memories_b = await get_memories_at_commit(driver, resolved_b.get("commit_id"))

    index_a = _snapshot_index(memories_a)
    index_b = _snapshot_index(memories_b)

    only_a = [memory for key, memory in index_a.items() if key not in index_b]
    only_b = [memory for key, memory in index_b.items() if key not in index_a]

    return {
        "branch_a": ref_a,
        "branch_b": ref_b,
        "only_a": only_a,
        "only_b": only_b,
    }


async def workspace_merge_preview(
    driver: AsyncDriver,
    *,
    source_branch: str,
    target_branch: str | None = None,
    user_id: str = "default",
) -> dict:
    workspace = await get_workspace_record(driver, user_id)
    if workspace and workspace.get("mode") == "detached":
        raise ValueError("Cannot merge while detached. Checkout a branch first.")

    resolved_target_branch = target_branch or (workspace.get("branch_name") if workspace else None)
    if not resolved_target_branch:
        raise ValueError("No target branch provided and no attached workspace branch is active.")
    if resolved_target_branch == source_branch:
        raise ValueError("Source and target branches must differ.")

    target_info = await get_branch_info(driver, resolved_target_branch)
    if not target_info:
        raise ValueError(f"Unknown target branch '{resolved_target_branch}'")

    source_info = await get_branch_info(driver, source_branch)
    if not source_info:
        raise ValueError(f"Unknown source branch '{source_branch}'")

    target_head_id = target_info.get("head_commit_id")
    source_head_id = source_info.get("head_commit_id")
    merge_base_commit_id = None
    mode = "merge_required"

    if not source_head_id:
        mode = "up_to_date"
    elif not target_head_id:
        mode = "fast_forward"
    else:
        target_ancestors = await get_ancestors(driver, target_head_id)
        source_ancestors = await get_ancestors(driver, source_head_id)
        if source_head_id in target_ancestors:
            mode = "up_to_date"
            merge_base_commit_id = source_head_id
        elif target_head_id in source_ancestors:
            mode = "fast_forward"
            merge_base_commit_id = target_head_id
        else:
            merge_base = await find_merge_base(driver, target_head_id, source_head_id)
            merge_base_commit_id = merge_base["id"] if merge_base else None

    base_snapshot = await get_memories_at_commit(driver, merge_base_commit_id)
    target_snapshot = await get_memories_at_commit(driver, target_head_id)
    source_snapshot = await get_memories_at_commit(driver, source_head_id)
    target_delta = _snapshot_delta(base_snapshot, target_snapshot)
    source_delta = _snapshot_delta(base_snapshot, source_snapshot)
    conflicts, auto_merged = _detect_conflicts(target_delta, source_delta)

    return {
        "target_branch": resolved_target_branch,
        "source_branch": source_branch,
        "target_head_commit_id": target_head_id,
        "source_head_commit_id": source_head_id,
        "merge_base_commit_id": merge_base_commit_id,
        "mode": mode,
        "conflicts": conflicts,
        "auto_merged": auto_merged if mode != "up_to_date" else [],
        "stats": {
            "base_snapshot_count": len(base_snapshot),
            "target_snapshot_count": len(target_snapshot),
            "source_snapshot_count": len(source_snapshot),
            "target_delta_count": len(target_delta),
            "source_delta_count": len(source_delta),
            "conflict_count": len(conflicts),
            "auto_merged_count": len(auto_merged) if mode != "up_to_date" else 0,
        },
    }


async def _create_resolution_memory(
    driver: AsyncDriver,
    *,
    target_branch: str,
    user_id: str,
    session_id: str | None,
    conflict: dict[str, Any],
    choice: str,
    content: str | None = None,
) -> dict:
    memory_a = conflict["memory_a"]
    memory_b = conflict["memory_b"]
    template = memory_a if choice == "target" else memory_b
    resolved_content = content or template.get("content", "")
    memory_type = template.get("type", "fact")
    tags = sorted(set((memory_a.get("tags") or []) + (memory_b.get("tags") or [])))
    memory_id = str(uuid.uuid4())

    async with driver.session() as session:
        result = await session.run(
            queries.STORE_MEMORY,
            memoryId=memory_id,
            type=memory_type,
            content=resolved_content,
            tags=tags,
            branchName=target_branch,
            sessionId=session_id or "merge",
            userId=user_id,
        )
        record = await result.single()
        for old_memory_id in {memory_a["id"], memory_b["id"]}:
            await session.run(queries.LINK_MEMORY_SUPERSEDES, newId=memory_id, oldId=old_memory_id)

    return _serialize_memory_node(record["m"])


async def workspace_merge(
    driver: AsyncDriver,
    *,
    source_branch: str,
    target_branch: str | None = None,
    strategy: str = "auto",
    user_id: str = "default",
    resolutions: list[dict[str, Any]] | None = None,
) -> dict:
    preview = await workspace_merge_preview(
        driver,
        source_branch=source_branch,
        target_branch=target_branch,
        user_id=user_id,
    )
    workspace = await get_workspace_record(driver, user_id)

    if preview["mode"] == "up_to_date":
        return {
            **preview,
            "applied": False,
            "fast_forward_to_commit_id": None,
            "merge_commit": None,
            "commit_id": preview.get("target_head_commit_id"),
            "session_id": workspace.get("session_id") if workspace else None,
            "applied_resolution_count": 0,
            "status": await get_workspace_status(driver, user_id),
        }

    if preview["mode"] == "fast_forward":
        async with driver.session() as session:
            await session.run(
                queries.REPLACE_BRANCH_HEAD,
                branchName=preview["target_branch"],
                commitId=preview.get("source_head_commit_id"),
            )
        attach_result = await attach_branch(driver, preview["target_branch"], user_id=user_id, reuse_session=False)
        return {
            **preview,
            "applied": True,
            "fast_forward_to_commit_id": preview.get("source_head_commit_id"),
            "merge_commit": None,
            "commit_id": preview.get("source_head_commit_id"),
            "session_id": attach_result.get("session_id"),
            "applied_resolution_count": 0,
            "status": attach_result["status"],
        }

    conflicts = preview["conflicts"]
    if conflicts and strategy == "auto":
        return {
            **preview,
            "applied": False,
            "fast_forward_to_commit_id": None,
            "merge_commit": None,
            "commit_id": preview.get("target_head_commit_id"),
            "session_id": workspace.get("session_id") if workspace else None,
            "applied_resolution_count": 0,
            "status": await get_workspace_status(driver, user_id),
        }

    resolution_lookup: dict[tuple[str, str], dict[str, Any]] = {}
    for resolution in resolutions or []:
        resolution_lookup[(resolution["memory_a_id"], resolution["memory_b_id"])] = resolution
        resolution_lookup[(resolution["memory_b_id"], resolution["memory_a_id"])] = resolution

    resolution_memories = []
    session_id = workspace.get("session_id") if workspace else None
    for conflict in conflicts:
        if strategy == "favor_target":
            choice = "target"
            custom_content = None
        elif strategy == "favor_source":
            choice = "source"
            custom_content = None
        else:
            resolution = resolution_lookup.get((conflict["memory_a"]["id"], conflict["memory_b"]["id"]))
            if not resolution:
                raise ValueError("Manual merge requires an explicit resolution for every conflict.")
            choice = resolution["choice"]
            custom_content = resolution.get("content")
            if choice == "custom" and not custom_content:
                raise ValueError("Custom manual merge resolutions must include content.")
            if choice not in {"target", "source", "custom"}:
                raise ValueError(f"Unsupported manual merge choice '{choice}'")

        resolution_memories.append(
            await _create_resolution_memory(
                driver,
                target_branch=preview["target_branch"],
                user_id=user_id,
                session_id=session_id,
                conflict=conflict,
                choice="target" if choice == "custom" else choice,
                content=custom_content,
            )
        )

    commit_id = str(uuid.uuid4())
    commit_message = f"Merge branch '{preview['source_branch']}' into {preview['target_branch']}"
    summary = _merge_commit_summary(
        preview["source_branch"],
        preview["target_branch"],
        len(preview["auto_merged"]),
        len(resolution_memories),
    )

    async with driver.session() as session:
        result = await session.run(
            queries.CREATE_MERGE_COMMIT,
            commitId=commit_id,
            message=commit_message,
            summary=summary,
            memoryDeltaCount=len(resolution_memories),
            userId=user_id,
            branchName=preview["target_branch"],
            targetParentId=preview["target_head_commit_id"],
            sourceParentId=preview["source_head_commit_id"],
            mergeStrategy=strategy,
            mergedFromBranch=preview["source_branch"],
            mergeBaseCommitId=preview["merge_base_commit_id"],
            conflictsResolved=len(resolution_memories),
        )
        record = await result.single()
        merge_commit = _serialize_commit_node(record["c"], record.get("parents", []))

    attach_result = await attach_branch(driver, preview["target_branch"], user_id=user_id, reuse_session=False)
    return {
        **preview,
        "applied": True,
        "fast_forward_to_commit_id": None,
        "merge_commit": merge_commit,
        "commit_id": merge_commit["id"],
        "session_id": attach_result.get("session_id"),
        "applied_resolution_count": len(resolution_memories),
        "status": attach_result["status"],
    }


async def repair_workspace_graph(driver: AsyncDriver) -> None:
    async with driver.session() as session:
        branch_result = await session.run(queries.LIST_BRANCHES)
        branch_records = await branch_result.data()

    for record in branch_records:
        branch = record["b"]
        branch_name = branch["name"]
        head = record.get("head")
        branched_from = record.get("branchedFrom")

        async with driver.session() as session:
            commit_result = await session.run(queries.LIST_COMMITS, branchName=branch_name)
            commit_records = await commit_result.data()

        latest_local_commit = commit_records[0]["c"] if commit_records else None
        target_head_id = None
        if latest_local_commit:
            target_head_id = latest_local_commit["id"]
        elif branched_from:
            target_head_id = branched_from["id"]

        if target_head_id and (not head or head["id"] != target_head_id):
            async with driver.session() as session:
                await session.run(queries.REPLACE_BRANCH_HEAD, branchName=branch_name, commitId=target_head_id)

        if branched_from and commit_records:
            oldest = commit_records[-1]
            parent_ids = [parent["id"] for parent in (oldest.get("parents") or []) if parent]
            if not parent_ids:
                async with driver.session() as session:
                    await session.run(
                        queries.LINK_COMMIT_PARENT,
                        commitId=oldest["c"]["id"],
                        parentCommitId=branched_from["id"],
                    )
