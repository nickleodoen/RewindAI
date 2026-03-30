"""All API endpoints — thin routes, fat services."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from app.chat.orchestrator import chat
from app.graph import queries
from app.graph.neo4j_client import get_driver
from app.models.schema import (
    BranchResponse,
    ChatRequest,
    ChatResponse,
    CheckoutRequest,
    CommitResponse,
    CreateBranchRequest,
    CreateCommitRequest,
    CreateMemoryRequest,
    CreateSessionRequest,
    DiffRequest,
    DiffResponse,
    GraphResponse,
    MergePreviewResponse,
    MergeResponse,
    MemoryResponse,
    MessageResponse,
    SessionResponse,
    TimelineEntry,
    WorkspaceAttachBranchRequest,
    WorkspaceCheckoutRequest,
    WorkspaceCommitRequest,
    WorkspaceMergeRequest,
    WorkspaceStatusResponse,
)
from app.services.branch_service import (
    checkout,
    create_branch,
    create_commit,
    get_branch_graph,
    get_graph_neighborhood,
    get_timeline,
    list_branches,
    list_commits,
)
from app.services.workspace_service import (
    attach_branch,
    checkout_workspace,
    commit_workspace,
    create_session_with_context,
    diff_refs,
    get_log,
    get_workspace_status,
    workspace_merge,
    workspace_merge_preview,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1")


def neo4j_datetime_to_iso(val) -> str | None:
    """Convert Neo4j DateTime to ISO string, or return None."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    if hasattr(val, "to_native"):
        return val.to_native().isoformat()
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)


def _session_response(session: dict) -> SessionResponse:
    return SessionResponse(
        id=session["id"],
        branch_name=session["branch_name"],
        user_id=session["user_id"],
        created_at=session.get("created_at"),
        origin_commit_id=session.get("origin_commit_id"),
        origin_branch=session.get("origin_branch"),
        checkout_mode=session.get("checkout_mode"),
        reconstructed_at=session.get("reconstructed_at"),
    )


# ── Chat ──────────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    driver = await get_driver()
    session_id = req.session_id
    if not session_id:
        status = await get_workspace_status(driver, req.user_id)
        session_id = status.get("session_id")
        if not session_id:
            raise HTTPException(status_code=400, detail="No active workspace session. Run checkout first.")

    try:
        result = await chat(
            session_id=session_id,
            user_message=req.message,
            user_id=req.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return ChatResponse(
        session_id=session_id,
        response=result["response"],
        compaction_occurred=result["compaction_occurred"],
        memories_extracted=result["memories_extracted"],
        response_mode=result.get("response_mode", "live"),
        notice=result.get("notice"),
    )


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.post("/sessions", response_model=SessionResponse)
async def create_session(req: CreateSessionRequest):
    driver = await get_driver()
    session = await create_session_with_context(
        driver,
        branch_name=req.branch_name,
        user_id=req.user_id,
        checkout_mode=req.checkout_mode,
        origin_commit_id=req.origin_commit_id,
        origin_branch=req.origin_branch or req.branch_name,
        context_messages=None,
        reconstructed_at=req.reconstructed_at,
    )
    return _session_response(session)


@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions():
    driver = await get_driver()
    async with driver.session() as session:
        result = await session.run(queries.LIST_SESSIONS)
        records = await result.data()
        return [
            SessionResponse(
                id=record["s"]["id"],
                branch_name=record["s"]["branchName"],
                user_id=record["s"]["userId"],
                created_at=neo4j_datetime_to_iso(record["s"].get("createdAt")),
                origin_commit_id=record["s"].get("originCommitId"),
                origin_branch=record["s"].get("originBranch"),
                checkout_mode=record["s"].get("checkoutMode"),
                reconstructed_at=neo4j_datetime_to_iso(record["s"].get("reconstructedAt")),
            )
            for record in records
        ]


@router.get("/sessions/{session_id}/messages", response_model=list[MessageResponse])
async def get_session_messages(session_id: str):
    driver = await get_driver()
    async with driver.session() as session:
        result = await session.run(queries.GET_SESSION_TURNS, sessionId=session_id)
        records = await result.data()
        return [
            MessageResponse(
                id=record["ct"]["id"],
                role=record["ct"]["role"],
                content=record["ct"]["content"],
                created_at=neo4j_datetime_to_iso(record["ct"].get("createdAt")),
            )
            for record in records
        ]


# ── Workspace ─────────────────────────────────────────────────────────────────

@router.get("/workspace/status", response_model=WorkspaceStatusResponse)
async def workspace_status(user_id: str = Query(default="default")):
    driver = await get_driver()
    return WorkspaceStatusResponse(**await get_workspace_status(driver, user_id))


@router.post("/workspace/checkout")
async def workspace_checkout(req: WorkspaceCheckoutRequest):
    driver = await get_driver()
    try:
        result = await checkout_workspace(driver, req.ref, user_id=req.user_id, reuse_session=req.reuse_session)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/workspace/attach-branch")
async def workspace_attach_branch(req: WorkspaceAttachBranchRequest):
    driver = await get_driver()
    result = await attach_branch(driver, req.branch_name, user_id=req.user_id, reuse_session=req.reuse_session)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/workspace/commit")
async def workspace_commit_endpoint(req: WorkspaceCommitRequest):
    driver = await get_driver()
    result = await commit_workspace(driver, req.message, user_id=req.user_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.get("/workspace/merge-preview", response_model=MergePreviewResponse)
async def workspace_merge_preview_endpoint(
    source_branch: str = Query(...),
    target_branch: str | None = Query(default=None),
    user_id: str = Query(default="default"),
):
    driver = await get_driver()
    try:
        preview = await workspace_merge_preview(
            driver,
            source_branch=source_branch,
            target_branch=target_branch,
            user_id=user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return MergePreviewResponse(
        target_branch=preview["target_branch"],
        source_branch=preview["source_branch"],
        target_head_commit_id=preview.get("target_head_commit_id"),
        source_head_commit_id=preview.get("source_head_commit_id"),
        merge_base_commit_id=preview.get("merge_base_commit_id"),
        mode=preview["mode"],
        conflicts=[
            {
                "memory_a": MemoryResponse(**conflict["memory_a"]),
                "memory_b": MemoryResponse(**conflict["memory_b"]),
                "reason": conflict["reason"],
            }
            for conflict in preview.get("conflicts", [])
        ],
        auto_merged=[MemoryResponse(**memory) for memory in preview.get("auto_merged", [])],
        stats=preview.get("stats", {}),
    )


@router.post("/workspace/merge", response_model=MergeResponse)
async def workspace_merge_endpoint(req: WorkspaceMergeRequest):
    driver = await get_driver()
    try:
        result = await workspace_merge(
            driver,
            source_branch=req.source_branch,
            target_branch=req.target_branch,
            strategy=req.strategy,
            user_id=req.user_id,
            resolutions=[resolution.model_dump() for resolution in req.resolutions],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return MergeResponse(
        target_branch=result["target_branch"],
        source_branch=result["source_branch"],
        target_head_commit_id=result.get("target_head_commit_id"),
        source_head_commit_id=result.get("source_head_commit_id"),
        merge_base_commit_id=result.get("merge_base_commit_id"),
        mode=result["mode"],
        conflicts=[
            {
                "memory_a": MemoryResponse(**conflict["memory_a"]),
                "memory_b": MemoryResponse(**conflict["memory_b"]),
                "reason": conflict["reason"],
            }
            for conflict in result.get("conflicts", [])
        ],
        auto_merged=[MemoryResponse(**memory) for memory in result.get("auto_merged", [])],
        stats=result.get("stats", {}),
        applied=result.get("applied", False),
        fast_forward_to_commit_id=result.get("fast_forward_to_commit_id"),
        merge_commit=CommitResponse(**result["merge_commit"]) if result.get("merge_commit") else None,
        commit_id=result.get("commit_id"),
        session_id=result.get("session_id"),
        applied_resolution_count=result.get("applied_resolution_count", 0),
        status=WorkspaceStatusResponse(**result["status"]),
    )


@router.get("/log", response_model=list[CommitResponse])
async def log_endpoint(ref: str | None = None, user_id: str = Query(default="default")):
    driver = await get_driver()
    try:
        commits = await get_log(driver, ref=ref, user_id=user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [CommitResponse(**commit) for commit in commits]


# ── Branches ──────────────────────────────────────────────────────────────────

@router.post("/branches", response_model=BranchResponse)
async def create_branch_endpoint(req: CreateBranchRequest):
    driver = await get_driver()
    try:
        result = await create_branch(
            driver,
            req.branch_name,
            req.source_commit_id,
            req.user_id,
            req.source_ref,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return BranchResponse(**result)


@router.get("/branches", response_model=list[BranchResponse])
async def list_branches_endpoint():
    driver = await get_driver()
    branches = await list_branches(driver)
    return [BranchResponse(**branch) for branch in branches]


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
    try:
        result = await create_commit(
            driver,
            req.branch_name,
            req.message,
            req.user_id,
            req.session_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CommitResponse(**result)


@router.get("/commits", response_model=list[CommitResponse])
async def list_commits_endpoint(branch_name: str = "main"):
    driver = await get_driver()
    commits = await list_commits(driver, branch_name)
    return [CommitResponse(**commit) for commit in commits]


# ── Memories ──────────────────────────────────────────────────────────────────

@router.get("/memories", response_model=list[MemoryResponse])
async def list_memories(branch_name: str = "main"):
    driver = await get_driver()
    async with driver.session() as session:
        result = await session.run(queries.LIST_MEMORIES, branchName=branch_name)
        records = await result.data()
        return [
            MemoryResponse(
                id=record["m"]["id"],
                type=record["m"].get("type", "fact"),
                content=record["m"].get("content", ""),
                branch_name=record["m"].get("branchName", branch_name),
                tags=record["m"].get("tags", []),
                user_id=record["m"].get("userId"),
                created_at=neo4j_datetime_to_iso(record["m"].get("createdAt")),
            )
            for record in records
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
        memory = record["m"]

        for dep_id in req.depends_on:
            try:
                await session.run(queries.LINK_MEMORY_DEPENDENCY, fromId=memory_id, toId=dep_id)
            except Exception:
                pass

        for old_id in req.supersedes:
            try:
                await session.run(queries.LINK_MEMORY_SUPERSEDES, newId=memory_id, oldId=old_id)
            except Exception:
                pass

        return MemoryResponse(
            id=memory["id"],
            type=memory.get("type", "fact"),
            content=memory.get("content", ""),
            branch_name=memory.get("branchName", req.branch_name),
            tags=memory.get("tags", []),
            user_id=memory.get("userId"),
            created_at=neo4j_datetime_to_iso(memory.get("createdAt")),
        )


# ── Diff ──────────────────────────────────────────────────────────────────────

@router.post("/diff", response_model=DiffResponse)
async def diff_endpoint(req: DiffRequest):
    ref_a = req.ref_a or req.branch_a
    ref_b = req.ref_b or req.branch_b
    if not ref_a or not ref_b:
        raise HTTPException(status_code=400, detail="Provide ref_a/ref_b or branch_a/branch_b")

    driver = await get_driver()
    try:
        result = await diff_refs(driver, ref_a, ref_b)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return DiffResponse(
        branch_a=result["branch_a"],
        branch_b=result["branch_b"],
        only_a=[MemoryResponse(**memory) for memory in result["only_a"]],
        only_b=[MemoryResponse(**memory) for memory in result["only_b"]],
    )


# ── Graph Exploration ─────────────────────────────────────────────────────────

@router.get("/graph/neighborhood/{node_id}", response_model=GraphResponse)
async def graph_neighborhood(node_id: str):
    driver = await get_driver()
    result = await get_graph_neighborhood(driver, node_id)
    return GraphResponse(**result)


@router.get("/graph/branch/{branch_name}", response_model=GraphResponse)
async def branch_graph(branch_name: str):
    driver = await get_driver()
    result = await get_branch_graph(driver, branch_name)
    return GraphResponse(**result)


# ── Timeline ──────────────────────────────────────────────────────────────────

@router.get("/timeline/{branch_name}", response_model=list[TimelineEntry])
async def timeline(branch_name: str):
    driver = await get_driver()
    entries = await get_timeline(driver, branch_name)
    return [
        TimelineEntry(
            commit=CommitResponse(**entry["commit"]),
            parent_id=entry.get("parent_id"),
        )
        for entry in entries
    ]
