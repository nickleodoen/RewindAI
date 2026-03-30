"""All API endpoints — thin routes, fat services."""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.graph.neo4j_client import get_driver
from app.graph import queries
from app.chat.orchestrator import chat
from app.services.branch_service import (
    create_branch,
    list_branches,
    create_commit,
    list_commits,
    checkout,
    diff_branches,
    get_timeline,
    get_graph_neighborhood,
)
from app.models.schema import (
    ChatRequest,
    ChatResponse,
    CreateSessionRequest,
    SessionResponse,
    CreateBranchRequest,
    BranchResponse,
    CheckoutRequest,
    CreateCommitRequest,
    CommitResponse,
    CreateMemoryRequest,
    MemoryResponse,
    DiffRequest,
    DiffResponse,
    GraphResponse,
    TimelineEntry,
    MessageResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1")


def neo4j_datetime_to_iso(val) -> str | None:
    """Convert Neo4j DateTime to ISO string, or return None."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    # neo4j.time.DateTime has .isoformat() or .to_native()
    if hasattr(val, "to_native"):
        return val.to_native().isoformat()
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)


# ── Chat ──────────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    # Get session's branch
    driver = await get_driver()
    async with driver.session() as session:
        result = await session.run(
            "MATCH (s:Session {id: $sessionId}) RETURN s",
            sessionId=req.session_id,
        )
        record = await result.single()
        if not record:
            raise HTTPException(status_code=404, detail="Session not found")
        branch_name = record["s"]["branchName"]

    result = await chat(
        session_id=req.session_id,
        user_message=req.message,
        branch_name=branch_name,
        user_id=req.user_id,
    )
    return ChatResponse(
        session_id=req.session_id,
        response=result["response"],
        compaction_occurred=result["compaction_occurred"],
        memories_extracted=result["memories_extracted"],
    )


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.post("/sessions", response_model=SessionResponse)
async def create_session(req: CreateSessionRequest):
    driver = await get_driver()
    session_id = str(uuid.uuid4())
    async with driver.session() as session:
        await session.run(queries.ENSURE_USER, userId=req.user_id, userName=req.user_id)
        result = await session.run(
            queries.CREATE_SESSION,
            sessionId=session_id,
            branchName=req.branch_name,
            userId=req.user_id,
        )
        record = await result.single()
        s = record["s"]
        return SessionResponse(
            id=s["id"],
            branch_name=s["branchName"],
            user_id=s["userId"],
            created_at=neo4j_datetime_to_iso(s.get("createdAt")),
        )


@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions():
    driver = await get_driver()
    async with driver.session() as session:
        result = await session.run(queries.LIST_SESSIONS)
        records = await result.data()
        return [
            SessionResponse(
                id=r["s"]["id"],
                branch_name=r["s"]["branchName"],
                user_id=r["s"]["userId"],
                created_at=neo4j_datetime_to_iso(r["s"].get("createdAt")),
            )
            for r in records
        ]


@router.get("/sessions/{session_id}/messages", response_model=list[MessageResponse])
async def get_session_messages(session_id: str):
    driver = await get_driver()
    async with driver.session() as session:
        result = await session.run(queries.GET_SESSION_TURNS, sessionId=session_id)
        records = await result.data()
        return [
            MessageResponse(
                id=r["ct"]["id"],
                role=r["ct"]["role"],
                content=r["ct"]["content"],
                created_at=neo4j_datetime_to_iso(r["ct"].get("createdAt")),
            )
            for r in records
        ]


# ── Branches ──────────────────────────────────────────────────────────────────

@router.post("/branches", response_model=BranchResponse)
async def create_branch_endpoint(req: CreateBranchRequest):
    driver = await get_driver()
    result = await create_branch(
        driver, req.branch_name, req.source_commit_id, req.user_id
    )
    return BranchResponse(**result)


@router.get("/branches", response_model=list[BranchResponse])
async def list_branches_endpoint():
    driver = await get_driver()
    branches = await list_branches(driver)
    return [BranchResponse(**b) for b in branches]


@router.post("/branches/checkout")
async def checkout_endpoint(req: CheckoutRequest):
    driver = await get_driver()
    result = await checkout(driver, req.branch_name, req.commit_id, req.user_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ── Commits ───────────────────────────────────────────────────────────────────

@router.post("/commits", response_model=CommitResponse)
async def create_commit_endpoint(req: CreateCommitRequest):
    driver = await get_driver()
    result = await create_commit(driver, req.branch_name, req.message, req.user_id)
    return CommitResponse(**result)


@router.get("/commits", response_model=list[CommitResponse])
async def list_commits_endpoint(branch_name: str = "main"):
    driver = await get_driver()
    commits = await list_commits(driver, branch_name)
    return [CommitResponse(**c) for c in commits]


# ── Memories ──────────────────────────────────────────────────────────────────

@router.get("/memories", response_model=list[MemoryResponse])
async def list_memories(branch_name: str = "main"):
    driver = await get_driver()
    async with driver.session() as session:
        result = await session.run(queries.LIST_MEMORIES, branchName=branch_name)
        records = await result.data()
        return [
            MemoryResponse(
                id=r["m"]["id"],
                type=r["m"].get("type", "fact"),
                content=r["m"].get("content", ""),
                branch_name=r["m"].get("branchName", branch_name),
                tags=r["m"].get("tags", []),
                user_id=r["m"].get("userId"),
                created_at=neo4j_datetime_to_iso(r["m"].get("createdAt")),
            )
            for r in records
        ]


@router.post("/memories", response_model=MemoryResponse)
async def create_memory(req: CreateMemoryRequest):
    driver = await get_driver()
    memory_id = str(uuid.uuid4())
    async with driver.session() as session:
        await session.run(queries.ENSURE_USER, userId=req.user_id, userName=req.user_id)
        result = await session.run(
            queries.STORE_MEMORY,
            memoryId=memory_id,
            type=req.type,
            content=req.content,
            tags=req.tags,
            branchName=req.branch_name,
            sessionId="manual",
            userId=req.user_id,
        )
        record = await result.single()
        m = record["m"]

        # Link dependencies
        for dep_id in req.depends_on:
            try:
                await session.run(queries.LINK_MEMORY_DEPENDENCY, fromId=memory_id, toId=dep_id)
            except Exception:
                pass

        # Link supersedes
        for old_id in req.supersedes:
            try:
                await session.run(queries.LINK_MEMORY_SUPERSEDES, newId=memory_id, oldId=old_id)
            except Exception:
                pass

        return MemoryResponse(
            id=m["id"],
            type=m.get("type", "fact"),
            content=m.get("content", ""),
            branch_name=m.get("branchName", req.branch_name),
            tags=m.get("tags", []),
            user_id=m.get("userId"),
            created_at=neo4j_datetime_to_iso(m.get("createdAt")),
        )


# ── Diff ──────────────────────────────────────────────────────────────────────

@router.post("/diff", response_model=DiffResponse)
async def diff_endpoint(req: DiffRequest):
    driver = await get_driver()
    result = await diff_branches(driver, req.branch_a, req.branch_b)
    return DiffResponse(
        branch_a=result["branch_a"],
        branch_b=result["branch_b"],
        only_a=[MemoryResponse(**m) for m in result["only_a"]],
        only_b=[MemoryResponse(**m) for m in result["only_b"]],
    )


# ── Graph Exploration ─────────────────────────────────────────────────────────

@router.get("/graph/neighborhood/{node_id}", response_model=GraphResponse)
async def graph_neighborhood(node_id: str):
    driver = await get_driver()
    result = await get_graph_neighborhood(driver, node_id)
    return GraphResponse(**result)


# ── Timeline ──────────────────────────────────────────────────────────────────

@router.get("/timeline/{branch_name}", response_model=list[TimelineEntry])
async def timeline(branch_name: str):
    driver = await get_driver()
    entries = await get_timeline(driver, branch_name)
    return [
        TimelineEntry(
            commit=CommitResponse(**e["commit"]),
            parent_id=e.get("parent_id"),
        )
        for e in entries
    ]
