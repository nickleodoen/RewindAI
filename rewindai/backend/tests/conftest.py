"""Pytest fixtures for backend integration tests."""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from neo4j import AsyncGraphDatabase

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(ROOT / "backend"))

from app.config import settings
from app.graph import queries
from app.graph.schema import ensure_schema
from app.services.branch_service import create_branch, create_commit
from app.services.workspace_service import repair_workspace_graph


@pytest_asyncio.fixture
async def driver():
    driver = AsyncGraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password),
    )
    yield driver
    await driver.close()


async def _store_memory(driver, *, branch_name: str, user_id: str, mem_type: str, content: str, tags: list[str] | None = None) -> str:
    tags = tags or []
    async with driver.session() as session:
        await session.run(queries.ENSURE_USER, userId=user_id, userName=user_id)
        result = await session.run(
            queries.STORE_MEMORY,
            memoryId=str(uuid.uuid4()),
            type=mem_type,
            content=content,
            tags=tags,
            branchName=branch_name,
            sessionId="seed",
            userId=user_id,
        )
        record = await result.single()
        return record["m"]["id"]


@pytest_asyncio.fixture
async def clean_graph(driver):
    async with driver.session() as session:
        await session.run("MATCH (n) DETACH DELETE n")
        await ensure_schema(driver)
        await session.run(queries.ENSURE_MAIN_BRANCH)
    await repair_workspace_graph(driver)
    yield driver


@pytest_asyncio.fixture
async def seeded_history(clean_graph):
    driver = clean_graph

    await _store_memory(
        driver,
        branch_name="main",
        user_id="alice",
        mem_type="decision",
        content="REST API chosen for backend endpoints",
        tags=["api"],
    )
    commit_one = await create_commit(driver, "main", "API direction", "alice")

    await _store_memory(
        driver,
        branch_name="main",
        user_id="alice",
        mem_type="decision",
        content="JWT auth required for private routes",
        tags=["auth"],
    )
    commit_two = await create_commit(driver, "main", "Auth hardening", "alice")

    feature_branch = await create_branch(
        driver,
        branch_name="graphql-exploration",
        source_commit_id=commit_one["id"],
        user_id="bob",
    )
    await _store_memory(
        driver,
        branch_name="graphql-exploration",
        user_id="bob",
        mem_type="decision",
        content="GraphQL explored as an alternative API layer",
        tags=["api", "graphql"],
    )
    feature_commit = await create_commit(driver, "graphql-exploration", "GraphQL exploration", "bob")

    await repair_workspace_graph(driver)
    return {
        "driver": driver,
        "main_commit_1": commit_one,
        "main_commit_2": commit_two,
        "feature_branch": feature_branch,
        "feature_commit": feature_commit,
    }


@pytest_asyncio.fixture
async def merge_history(clean_graph):
    driver = clean_graph

    await _store_memory(
        driver,
        branch_name="main",
        user_id="alice",
        mem_type="context",
        content="API architecture exploration started",
        tags=["api"],
    )
    base_commit = await create_commit(driver, "main", "Architecture kickoff", "alice")

    await _store_memory(
        driver,
        branch_name="main",
        user_id="alice",
        mem_type="decision",
        content="Use REST API for the backend service layer",
        tags=["api", "rest"],
    )
    target_commit = await create_commit(driver, "main", "REST direction", "alice")

    source_branch = await create_branch(
        driver,
        branch_name="graphql-exploration",
        source_commit_id=base_commit["id"],
        user_id="bob",
    )
    await _store_memory(
        driver,
        branch_name="graphql-exploration",
        user_id="bob",
        mem_type="decision",
        content="Use GraphQL API for the backend service layer",
        tags=["api", "graphql"],
    )
    await _store_memory(
        driver,
        branch_name="graphql-exploration",
        user_id="bob",
        mem_type="fact",
        content="Schema stitching may simplify partner integrations",
        tags=["graphql", "schema"],
    )
    source_commit = await create_commit(driver, "graphql-exploration", "GraphQL direction", "bob")

    await repair_workspace_graph(driver)
    return {
        "driver": driver,
        "base_commit": base_commit,
        "target_commit": target_commit,
        "source_branch": source_branch,
        "source_commit": source_commit,
    }
