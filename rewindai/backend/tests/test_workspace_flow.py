"""Integration tests for the workspace and Git-for-memory workflow."""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(ROOT / "backend"))

from app.api import routes as api_routes
from app.chat import orchestrator as chat_orchestrator
from app.compaction.interceptor import handle_compaction_event
from app.config import settings
from app.graph import queries
from app.main import app
from app.chat.context_builder import build_context_for_checkout
from app.services.branch_service import create_branch
from app.services.workspace_service import (
    attach_branch,
    checkout_workspace,
    commit_workspace,
    create_commit_on_branch,
    diff_refs,
    find_merge_base,
    get_log,
    get_memories_at_commit,
    get_workspace_status,
    workspace_merge,
    workspace_merge_preview,
)


pytestmark = pytest.mark.asyncio


async def _store_memory(driver, *, branch_name: str, user_id: str, mem_type: str, content: str, tags: list[str] | None = None) -> str:
    async with driver.session() as session:
        await session.run(queries.ENSURE_USER, userId=user_id, userName=user_id)
        result = await session.run(
            queries.STORE_MEMORY,
            memoryId=str(uuid.uuid4()),
            type=mem_type,
            content=content,
            tags=tags or [],
            branchName=branch_name,
            sessionId="seed",
            userId=user_id,
        )
        record = await result.single()
        return record["m"]["id"]


async def test_checkout_branch_and_detached_status(seeded_history):
    driver = seeded_history["driver"]

    attached = await checkout_workspace(driver, "main", user_id="alice")
    assert attached["mode"] == "attached"
    assert attached["commit_id"] == seeded_history["main_commit_2"]["id"]

    detached = await checkout_workspace(driver, seeded_history["main_commit_1"]["id"], user_id="alice")
    assert detached["mode"] == "detached"
    status = await get_workspace_status(driver, "alice")
    assert status["mode"] == "detached"
    assert status["origin_branch"] == "main"
    assert status["head_commit_id"] == seeded_history["main_commit_1"]["id"]


async def test_branch_creation_from_historical_ref_updates_head_and_parent(seeded_history):
    driver = seeded_history["driver"]

    branch = await create_branch(
        driver,
        branch_name="rest-fork",
        source_ref=seeded_history["main_commit_1"]["id"],
        user_id="alice",
    )
    assert branch["branched_from_commit_id"] == seeded_history["main_commit_1"]["id"]
    assert branch["head_commit_id"] == seeded_history["main_commit_1"]["id"]

    await attach_branch(driver, "rest-fork", user_id="alice")
    commit = await create_commit_on_branch(driver, "rest-fork", "Fork commit", user_id="alice")
    assert commit["parent_id"] == seeded_history["main_commit_1"]["id"]


async def test_detached_head_blocks_commit(seeded_history):
    driver = seeded_history["driver"]

    await checkout_workspace(driver, seeded_history["main_commit_1"]["id"], user_id="alice")
    result = await commit_workspace(driver, "Should fail", user_id="alice")
    assert "error" in result
    assert "Detached HEAD" in result["error"]


async def test_chat_uses_workspace_session_when_session_id_missing(seeded_history):
    driver = seeded_history["driver"]
    await checkout_workspace(driver, "main", user_id="alice")

    async def _get_driver_override():
        return driver

    app.dependency_overrides = {}
    transport = httpx.ASGITransport(app=app)
    api_routes.get_driver = _get_driver_override
    chat_orchestrator.get_driver = _get_driver_override
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/v1/chat", json={"message": "What did we decide?", "user_id": "alice"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"]
    assert "response" in payload


async def test_chat_returns_structured_fallback_without_raw_provider_text(seeded_history, monkeypatch):
    driver = seeded_history["driver"]
    await checkout_workspace(driver, "main", user_id="alice")
    monkeypatch.setattr(settings, "anthropic_api_key", "your_key_here")

    async def _get_driver_override():
        return driver

    api_routes.get_driver = _get_driver_override
    chat_orchestrator.get_driver = _get_driver_override
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/api/v1/chat", json={"message": "What architecture decisions do we have?", "user_id": "alice"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["response_mode"] in {"fallback", "mock"}
    assert payload["notice"]
    assert not payload["response"].startswith("[API Error]")
    assert not payload["response"].startswith("[Mock]")


async def test_detached_compaction_does_not_persist_memories(seeded_history):
    driver = seeded_history["driver"]
    detached = await checkout_workspace(driver, seeded_history["main_commit_1"]["id"], user_id="alice")

    before = await get_memories_at_commit(driver, seeded_history["main_commit_1"]["id"])
    count = await handle_compaction_event(
        driver=driver,
        session_id=detached["session_id"],
        branch_name="main",
        user_id="alice",
        compaction_content="Compacted history",
        pre_compaction_messages=[
            {"role": "user", "content": "We decided to use Postgres for analytics."},
            {"role": "assistant", "content": "That sounds good and should be tracked."},
        ],
        token_count=42,
        persist_memories=False,
    )
    after = await get_memories_at_commit(driver, seeded_history["main_commit_1"]["id"])
    assert count == 0
    assert len(after) == len(before)


async def test_commit_summary_and_memory_sync_from_session_turns(seeded_history):
    driver = seeded_history["driver"]
    checkout = await checkout_workspace(driver, "main", user_id="alice")

    async with driver.session() as session:
        await session.run(
            queries.STORE_TURN,
            turnId="turn-a",
            sessionId=checkout["session_id"],
            role="user",
            content="We decided to add Redis caching and need to implement it next sprint.",
            branchName="main",
        )
        await session.run(
            queries.STORE_TURN,
            turnId="turn-b",
            sessionId=checkout["session_id"],
            role="assistant",
            content="I will remember that Redis caching is a decision and implementation follow-up.",
            branchName="main",
        )

    commit = await commit_workspace(driver, "Caching direction", user_id="alice")
    assert commit["memory_delta_count"] > 0
    assert commit["summary"]


async def test_ref_aware_diff_and_log_follow_branch_lineage(seeded_history):
    driver = seeded_history["driver"]

    log_entries = await get_log(driver, ref="graphql-exploration", user_id="alice")
    commit_ids = [entry["id"] for entry in log_entries]
    assert seeded_history["feature_commit"]["id"] in commit_ids
    assert seeded_history["main_commit_1"]["id"] in commit_ids

    diff = await diff_refs(driver, "main", "graphql-exploration", user_id="alice")
    assert any("JWT auth required" in memory["content"] for memory in diff["only_a"])
    assert any("GraphQL explored" in memory["content"] for memory in diff["only_b"])


async def test_merge_preview_finds_merge_base_and_conflicts(merge_history):
    driver = merge_history["driver"]
    await checkout_workspace(driver, "main", user_id="alice")

    preview = await workspace_merge_preview(driver, source_branch="graphql-exploration", user_id="alice")
    merge_base = await find_merge_base(
        driver,
        merge_history["target_commit"]["id"],
        merge_history["source_commit"]["id"],
    )

    assert preview["mode"] == "merge_required"
    assert preview["merge_base_commit_id"] == merge_history["base_commit"]["id"]
    assert merge_base and merge_base["id"] == merge_history["base_commit"]["id"]
    assert len(preview["conflicts"]) == 1
    assert "GraphQL" in preview["conflicts"][0]["memory_b"]["content"]
    assert any("Schema stitching" in memory["content"] for memory in preview["auto_merged"])


async def test_auto_merge_stops_when_conflicts_exist(merge_history):
    driver = merge_history["driver"]
    await checkout_workspace(driver, "main", user_id="alice")

    result = await workspace_merge(driver, source_branch="graphql-exploration", strategy="auto", user_id="alice")
    status = await get_workspace_status(driver, "alice")

    assert result["applied"] is False
    assert result["merge_commit"] is None
    assert status["head_commit_id"] == merge_history["target_commit"]["id"]


async def test_favor_source_merge_creates_merge_commit_and_merged_snapshot(merge_history):
    driver = merge_history["driver"]
    await checkout_workspace(driver, "main", user_id="alice")

    result = await workspace_merge(driver, source_branch="graphql-exploration", strategy="favor_source", user_id="alice")
    merge_commit = result["merge_commit"]
    assert result["applied"] is True
    assert merge_commit["is_merge"] is True
    assert len(merge_commit["parent_ids"]) == 2
    assert set(merge_commit["parent_ids"]) == {merge_history["target_commit"]["id"], merge_history["source_commit"]["id"]}

    memories = await get_memories_at_commit(driver, merge_commit["id"])
    contents = [memory["content"] for memory in memories]
    assert "Use GraphQL API for the backend service layer" in contents
    assert "Use REST API for the backend service layer" not in contents
    assert "Schema stitching may simplify partner integrations" in contents


async def test_favor_target_merge_keeps_target_resolution_and_auto_merges_source_facts(merge_history):
    driver = merge_history["driver"]
    await checkout_workspace(driver, "main", user_id="alice")

    result = await workspace_merge(driver, source_branch="graphql-exploration", strategy="favor_target", user_id="alice")
    merge_commit = result["merge_commit"]
    memories = await get_memories_at_commit(driver, merge_commit["id"])
    contents = [memory["content"] for memory in memories]

    assert result["applied"] is True
    assert merge_commit["is_merge"] is True
    assert "Use REST API for the backend service layer" in contents
    assert "Use GraphQL API for the backend service layer" not in contents
    assert "Schema stitching may simplify partner integrations" in contents


async def test_manual_merge_custom_resolution_updates_context_and_checkout(merge_history):
    driver = merge_history["driver"]
    await checkout_workspace(driver, "main", user_id="alice")
    preview = await workspace_merge_preview(driver, source_branch="graphql-exploration", user_id="alice")
    conflict = preview["conflicts"][0]

    result = await workspace_merge(
        driver,
        source_branch="graphql-exploration",
        strategy="manual",
        user_id="alice",
        resolutions=[
            {
                "memory_a_id": conflict["memory_a"]["id"],
                "memory_b_id": conflict["memory_b"]["id"],
                "choice": "custom",
                "content": "Use REST externally and GraphQL for internal graph-heavy tooling",
            }
        ],
    )

    merge_commit = result["merge_commit"]
    detached = await checkout_workspace(driver, merge_commit["id"], user_id="alice")
    context_messages = await build_context_for_checkout(driver, merge_commit["id"])
    context_text = "\n".join(message["content"] for message in context_messages)
    log_entries = await get_log(driver, merge_commit["id"], user_id="alice")

    assert detached["mode"] == "detached"
    assert "Use REST externally and GraphQL for internal graph-heavy tooling" in context_text
    assert "Use REST API for the backend service layer" not in context_text
    assert "Use GraphQL API for the backend service layer" not in context_text
    assert log_entries[0]["id"] == merge_commit["id"]
    assert any(entry["id"] == merge_history["source_commit"]["id"] for entry in log_entries)


async def test_fast_forward_merge_updates_head_without_merge_commit(clean_graph):
    driver = clean_graph

    await _store_memory(
        driver,
        branch_name="main",
        user_id="alice",
        mem_type="fact",
        content="Initial architecture note",
        tags=["init"],
    )
    base_commit = await create_commit_on_branch(driver, "main", "Initial snapshot", user_id="alice")
    await create_branch(driver, "feature-x", source_ref=base_commit["id"], user_id="alice")
    await _store_memory(
        driver,
        branch_name="feature-x",
        user_id="alice",
        mem_type="fact",
        content="Feature branch learned about websocket subscriptions",
        tags=["realtime"],
    )
    feature_commit = await create_commit_on_branch(driver, "feature-x", "Realtime exploration", user_id="alice")

    await checkout_workspace(driver, "main", user_id="alice")
    result = await workspace_merge(driver, source_branch="feature-x", strategy="auto", user_id="alice")
    status = await get_workspace_status(driver, "alice")

    assert result["mode"] == "fast_forward"
    assert result["applied"] is True
    assert result["merge_commit"] is None
    assert result["fast_forward_to_commit_id"] == feature_commit["id"]
    assert status["head_commit_id"] == feature_commit["id"]
