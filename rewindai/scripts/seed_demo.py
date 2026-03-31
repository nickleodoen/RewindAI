#!/usr/bin/env python3
"""Seed and verify a deterministic RewindAI demo storyline."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib import error, parse, request

from neo4j import AsyncGraphDatabase

ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import settings
from app.graph import queries
from app.graph.schema import ensure_schema
from app.services.branch_service import create_branch
from app.services.workspace_service import create_commit_on_branch, repair_workspace_graph


DEMO_USER = "demo"
ALICE = "alice"
BOB = "bob"


class DemoSeedError(RuntimeError):
    """Raised when the demo dataset cannot be seeded or verified."""


def _print(message: str) -> None:
    print(f"[rewindai-demo] {message}")


def _http_request_json(
    method: str,
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> Any:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(url, data=data, method=method, headers=headers)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise DemoSeedError(f"{method} {url} failed: {detail or exc.reason}") from exc
    except error.URLError as exc:
        raise DemoSeedError(f"Failed to reach backend at {url}: {exc.reason}") from exc

    if not raw:
        return None
    return json.loads(raw)


def _api_url(base_url: str, path: str, **params: str) -> str:
    query = parse.urlencode({key: value for key, value in params.items() if value is not None})
    suffix = f"?{query}" if query else ""
    return f"{base_url.rstrip('/')}{path}{suffix}"


async def _clear_graph(driver) -> None:
    async with driver.session() as session:
        await session.run("MATCH (n) DETACH DELETE n")
        await ensure_schema(driver)
        await session.run(queries.ENSURE_MAIN_BRANCH)
    await repair_workspace_graph(driver)


async def _store_memory(
    driver,
    *,
    branch_name: str,
    user_id: str,
    mem_type: str,
    content: str,
    tags: list[str] | None = None,
) -> str:
    async with driver.session() as session:
        await session.run(queries.ENSURE_USER, userId=user_id, userName=user_id)
        result = await session.run(
            queries.STORE_MEMORY,
            memoryId=str(uuid.uuid4()),
            type=mem_type,
            content=content,
            tags=tags or [],
            branchName=branch_name,
            sessionId="seed-demo",
            userId=user_id,
        )
        record = await result.single()
        return record["m"]["id"]


async def _seed_story(driver, *, api_url: str, user_id: str) -> dict[str, Any]:
    _print("Resetting Neo4j data and applying schema...")
    await _clear_graph(driver)

    _print("Seeding main branch narrative...")
    await _store_memory(
        driver,
        branch_name="main",
        user_id=ALICE,
        mem_type="context",
        content="RewindAI needs a versioned API surface that works for both the browser demo and the CLI.",
        tags=["api", "product"],
    )
    kickoff_commit = await create_commit_on_branch(driver, "main", "Architecture kickoff", user_id=ALICE)

    await create_branch(
        driver,
        branch_name="graphql-exploration",
        source_commit_id=kickoff_commit["id"],
        user_id=BOB,
    )

    await _store_memory(
        driver,
        branch_name="main",
        user_id=ALICE,
        mem_type="decision",
        content="Use REST for the public application API so the browser demo and CLI share stable endpoints.",
        tags=["api", "public-api", "rest"],
    )
    await _store_memory(
        driver,
        branch_name="main",
        user_id=ALICE,
        mem_type="decision",
        content="JWT auth protects private write routes used by the team workspace.",
        tags=["auth", "security"],
    )
    rest_commit = await create_commit_on_branch(driver, "main", "REST public API direction", user_id=ALICE)

    await _store_memory(
        driver,
        branch_name="main",
        user_id=ALICE,
        mem_type="fact",
        content="Redis caching keeps graph and timeline reads fast enough for the live demo.",
        tags=["performance", "redis", "cache"],
    )
    await _store_memory(
        driver,
        branch_name="main",
        user_id=ALICE,
        mem_type="question",
        content="Cursor-light pagination is acceptable for the first demo cut.",
        tags=["pagination", "scope"],
    )
    main_head_commit = await create_commit_on_branch(driver, "main", "Performance baseline", user_id=ALICE)

    _print("Seeding alternate GraphQL branch...")
    await _store_memory(
        driver,
        branch_name="graphql-exploration",
        user_id=BOB,
        mem_type="decision",
        content="Use GraphQL for the public application API to support flexible graph-heavy queries.",
        tags=["api", "public-api", "graphql"],
    )
    await _store_memory(
        driver,
        branch_name="graphql-exploration",
        user_id=BOB,
        mem_type="fact",
        content="Schema stitching can simplify partner integrations without duplicating resolver logic.",
        tags=["graphql", "schema", "partners"],
    )
    await _store_memory(
        driver,
        branch_name="graphql-exploration",
        user_id=BOB,
        mem_type="action_item",
        content="Evaluate Apollo federation after the merge decision lands.",
        tags=["graphql", "apollo", "follow-up"],
    )
    graphql_head_commit = await create_commit_on_branch(
        driver,
        "graphql-exploration",
        "GraphQL exploration",
        user_id=BOB,
    )

    await create_branch(
        driver,
        branch_name="merged",
        source_commit_id=main_head_commit["id"],
        user_id=user_id,
    )
    await repair_workspace_graph(driver)

    _print("Creating the pre-merged showcase branch through the live merge API...")
    _http_request_json(
        "POST",
        _api_url(api_url, "/api/v1/workspace/attach-branch"),
        payload={"branch_name": "merged", "user_id": user_id, "reuse_session": False},
    )
    preview = _http_request_json(
        "GET",
        _api_url(
            api_url,
            "/api/v1/workspace/merge-preview",
            source_branch="graphql-exploration",
            target_branch="merged",
            user_id=user_id,
        ),
    )
    conflicts = preview.get("conflicts", [])
    if not conflicts:
        raise DemoSeedError("Expected a merge conflict between main and graphql-exploration, but none were found.")

    primary_conflict = conflicts[0]
    resolution_text = "Use REST for public APIs and GraphQL for internal graph-heavy workflows."
    merge_result = _http_request_json(
        "POST",
        _api_url(api_url, "/api/v1/workspace/merge"),
        payload={
            "source_branch": "graphql-exploration",
            "target_branch": "merged",
            "strategy": "manual",
            "user_id": user_id,
            "resolutions": [
                {
                    "memory_a_id": primary_conflict["memory_a"]["id"],
                    "memory_b_id": primary_conflict["memory_b"]["id"],
                    "choice": "custom",
                    "content": resolution_text,
                }
            ],
        },
    )
    if not merge_result.get("merge_commit"):
        raise DemoSeedError("The pre-seeded merged-demo branch did not produce a merge commit.")

    _http_request_json(
        "POST",
        _api_url(api_url, "/api/v1/workspace/attach-branch"),
        payload={"branch_name": "main", "user_id": user_id, "reuse_session": False},
    )

    return {
        "kickoff_commit": kickoff_commit,
        "main_head_commit": main_head_commit,
        "rest_commit": rest_commit,
        "graphql_head_commit": graphql_head_commit,
        "merged_demo_commit": merge_result["merge_commit"],
        "resolution_text": resolution_text,
    }


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise DemoSeedError(message)


def _find_merge_nodes(graph_payload: dict[str, Any]) -> list[dict[str, Any]]:
    merge_nodes = []
    for node in graph_payload.get("nodes", []):
        props = node.get("properties", {})
        parent_ids = props.get("parentIds") or props.get("parent_ids") or []
        if props.get("isMerge") or props.get("is_merge") or len(parent_ids) > 1:
            merge_nodes.append(node)
    return merge_nodes


def _response_has_raw_provider_text(chat_payload: dict[str, Any]) -> bool:
    response_text = chat_payload.get("response", "")
    return response_text.startswith("[API Error]") or response_text.startswith("[Mock]")


def verify_demo_state(*, api_url: str, user_id: str) -> None:
    _print("Verifying seeded demo state via the live API...")
    health = _http_request_json("GET", _api_url(api_url, "/health"))
    _assert(health.get("status") == "ok", "Backend health check did not return ok.")
    _assert(str(health.get("neo4j", "")).startswith("connected"), "Neo4j is not connected.")

    branches = _http_request_json("GET", _api_url(api_url, "/api/v1/branches"))
    branch_lookup = {branch["name"]: branch for branch in branches}
    for expected_branch in ("main", "graphql-exploration", "merged"):
        _assert(expected_branch in branch_lookup, f"Expected branch '{expected_branch}' to exist.")

    preview = _http_request_json(
        "GET",
        _api_url(
            api_url,
            "/api/v1/workspace/merge-preview",
            source_branch="graphql-exploration",
            target_branch="main",
            user_id=user_id,
        ),
    )
    _assert(preview["mode"] == "merge_required", "main vs graphql-exploration should require a merge.")
    _assert(len(preview.get("conflicts", [])) >= 1, "Expected at least one conflict in merge preview.")
    _assert(len(preview.get("auto_merged", [])) >= 1, "Expected at least one auto-merged memory in merge preview.")

    diff_payload = _http_request_json(
        "POST",
        _api_url(api_url, "/api/v1/diff"),
        payload={"branch_a": "main", "branch_b": "graphql-exploration"},
    )
    _assert(
        any("REST" in memory.get("content", "") for memory in diff_payload.get("only_a", [])),
        "Expected a REST-side memory in the main-only diff.",
    )
    _assert(
        any("GraphQL" in memory.get("content", "") for memory in diff_payload.get("only_b", [])),
        "Expected a GraphQL-side memory in the branch-only diff.",
    )

    merged_graph = _http_request_json(
        "GET",
        _api_url(api_url, "/api/v1/graph/branch/merged-demo"),
    )
    _assert(_find_merge_nodes(merged_graph), "Expected merged-demo graph to contain a merge commit node.")

    _http_request_json(
        "POST",
        _api_url(api_url, "/api/v1/workspace/attach-branch"),
        payload={"branch_name": "merged", "user_id": user_id, "reuse_session": False},
    )
    merged_chat = _http_request_json(
        "POST",
        _api_url(api_url, "/api/v1/chat"),
        payload={"message": "What API direction did we land on?", "user_id": user_id},
    )
    _assert(not _response_has_raw_provider_text(merged_chat), "Chat fallback still leaked raw provider text.")
    _assert(merged_chat.get("response_mode") in {"live", "fallback", "mock"}, "Unexpected chat response mode.")
    if merged_chat.get("response_mode") != "live":
        _assert(bool(merged_chat.get("notice")), "Fallback chat responses must include a notice.")

    status = _http_request_json(
        "POST",
        _api_url(api_url, "/api/v1/workspace/attach-branch"),
        payload={"branch_name": "main", "user_id": user_id, "reuse_session": False},
    )
    workspace_status = status["status"]
    _assert(workspace_status["mode"] == "attached", "Workspace should be attached after reset.")
    _assert(workspace_status["branch_name"] == "main", "Reset should end with the demo workspace attached to main.")
    _assert(bool(workspace_status.get("head_commit_id")), "Workspace HEAD should be set after reset.")

    _print("Verification complete: branches, merge preview, graph merge node, and chat fallback all look good.")


async def async_main(args: argparse.Namespace) -> None:
    driver = AsyncGraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password),
    )
    try:
        await _seed_story(driver, api_url=args.api_url, user_id=args.user_id)
    finally:
        await driver.close()

    if args.verify:
        verify_demo_state(api_url=args.api_url, user_id=args.user_id)

    _print("Demo dataset ready.")
    _print("Safe starting branch: merged")
    _print("Live interactive starting branch: main")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the deterministic RewindAI demo dataset.")
    parser.add_argument("--api-url", default="http://localhost:8000", help="Backend base URL.")
    parser.add_argument("--user-id", default=DEMO_USER, help="Workspace user to reset.")
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Verify the seeded state through the live API after seeding.",
    )
    args = parser.parse_args()

    try:
        asyncio.run(async_main(args))
    except DemoSeedError as exc:
        _print(f"ERROR: {exc}")
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
