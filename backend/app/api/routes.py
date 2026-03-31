"""API routes — thin layer, delegates to services."""

import logging

import anthropic
from fastapi import APIRouter, HTTPException

from app.config import settings
from app.graph.neo4j_client import get_driver
from app.models.schema import (
    ChatRequest,
    ChatResponse,
    CreateSnapshotRequest,
    DecisionEntry,
    RestoreResponse,
    SnapshotCreatedResponse,
    SnapshotListItem,
    SnapshotResponse,
)
from app.services import context_service, decision_service, snapshot_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")


# ─── Snapshots ───────────────────────────────────────────────────────────────

@router.post("/snapshots", response_model=SnapshotCreatedResponse)
async def create_snapshot(request: CreateSnapshotRequest):
    """Create a context snapshot for a commit."""
    driver = await get_driver()

    # Extract structured metadata from the conversation
    extracted = await context_service.extract_context(request.messages)

    result = await snapshot_service.create_snapshot(
        driver=driver,
        sha=request.sha,
        branch=request.branch,
        commit_message=request.commit_message,
        messages=request.messages,
        summary=extracted.get("summary", ""),
        decisions=extracted.get("decisions"),
        files_discussed=extracted.get("filesDiscussed"),
    )
    return SnapshotCreatedResponse(**result)


@router.get("/snapshots/{sha}")
async def get_snapshot(sha: str):
    """Get a snapshot with full metadata for context restoration."""
    driver = await get_driver()
    data = await snapshot_service.get_snapshot(driver, sha)
    if not data:
        raise HTTPException(status_code=404, detail=f"Snapshot not found: {sha}")

    snapshot = data["snapshot"]
    return RestoreResponse(
        snapshot=SnapshotResponse(
            sha=snapshot.get("sha", sha),
            branch=snapshot.get("branch", ""),
            timestamp=str(snapshot.get("timestamp", "")),
            summary=snapshot.get("summary", ""),
            token_count=snapshot.get("tokenCount", 0),
            commit_message=snapshot.get("commitMessage", ""),
        ),
        summary=snapshot.get("summary", ""),
        decisions=[
            {"content": d.get("content", ""), "rationale": d.get("rationale", "")}
            for d in data["decisions"]
        ],
        files_discussed=data["files"],
        compressed_context=data.get("compressed_context", ""),
    )


@router.get("/snapshots", response_model=list[SnapshotListItem])
async def list_snapshots(branch: str = "main", limit: int = 10):
    """List recent snapshots on a branch."""
    driver = await get_driver()
    snapshots = await snapshot_service.list_snapshots(driver, branch, limit)
    return [
        SnapshotListItem(
            sha=s.get("sha", ""),
            branch=s.get("branch", ""),
            timestamp=str(s.get("timestamp", "")),
            summary=s.get("summary", ""),
            commit_message=s.get("commitMessage", ""),
        )
        for s in snapshots
    ]


# ─── Decisions ───────────────────────────────────────────────────────────────

@router.get("/decisions", response_model=list[DecisionEntry])
async def get_decisions(branch: str | None = None):
    """List all decisions, optionally filtered by branch."""
    driver = await get_driver()
    entries = await decision_service.get_decisions(driver, branch)
    return [DecisionEntry(**e) for e in entries]


@router.get("/files/{file_path:path}/history", response_model=list[DecisionEntry])
async def get_file_history(file_path: str):
    """Get decision history for a specific file."""
    driver = await get_driver()
    entries = await decision_service.get_file_history(driver, file_path)
    return [DecisionEntry(**e) for e in entries]


# ─── Chat ────────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Send a message to Claude API with conversation history."""
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Anthropic API key not configured")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Build messages for Claude
    messages = []
    for m in request.conversation_history:
        messages.append({"role": m["role"], "content": m["content"]})

    # Add the new user message
    messages.append({"role": "user", "content": request.message})

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=request.system_prompt or "You are a helpful AI coding assistant.",
        messages=messages,
    )

    assistant_text = response.content[0].text

    # Return full updated history
    messages.append({"role": "assistant", "content": assistant_text})

    return ChatResponse(response=assistant_text, messages=messages)
