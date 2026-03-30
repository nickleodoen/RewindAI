"""Pydantic models for request/response schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ── Requests ──────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str
    user_id: str = "default"


class CreateSessionRequest(BaseModel):
    branch_name: str = "main"
    user_id: str = "default"
    origin_commit_id: str | None = None
    origin_branch: str | None = None
    checkout_mode: Literal["attached", "detached", "manual"] = "manual"
    reconstructed_at: str | None = None


class CreateBranchRequest(BaseModel):
    branch_name: str
    source_commit_id: str | None = None
    source_ref: str | None = None
    user_id: str = "default"


class CheckoutRequest(BaseModel):
    branch_name: str
    commit_id: str | None = None
    user_id: str = "default"


class CreateCommitRequest(BaseModel):
    branch_name: str = "main"
    message: str = ""
    user_id: str = "default"
    session_id: str | None = None


class CreateMemoryRequest(BaseModel):
    type: Literal["decision", "fact", "context", "action_item", "question"]
    content: str
    branch_name: str = "main"
    user_id: str = "default"
    tags: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    supersedes: list[str] = Field(default_factory=list)


class DiffRequest(BaseModel):
    branch_a: str | None = None
    branch_b: str | None = None
    ref_a: str | None = None
    ref_b: str | None = None


class WorkspaceCheckoutRequest(BaseModel):
    ref: str
    user_id: str = "default"
    reuse_session: bool = False


class WorkspaceAttachBranchRequest(BaseModel):
    branch_name: str
    user_id: str = "default"
    reuse_session: bool = False


class WorkspaceCommitRequest(BaseModel):
    message: str = ""
    user_id: str = "default"


MergeStrategy = Literal["auto", "favor_target", "favor_source", "manual"]


class WorkspaceMergePreviewRequest(BaseModel):
    source_branch: str
    target_branch: str | None = None
    user_id: str = "default"


class MergeResolutionRequest(BaseModel):
    memory_a_id: str
    memory_b_id: str
    choice: Literal["target", "source", "custom"]
    content: str | None = None


class WorkspaceMergeRequest(BaseModel):
    source_branch: str
    target_branch: str | None = None
    strategy: MergeStrategy = "auto"
    user_id: str = "default"
    resolutions: list[MergeResolutionRequest] = Field(default_factory=list)


# ── Responses ─────────────────────────────────────────────────────────────────

class ChatResponse(BaseModel):
    session_id: str
    response: str
    compaction_occurred: bool = False
    memories_extracted: int = 0
    response_mode: Literal["live", "fallback", "mock"] = "live"
    notice: str | None = None


class SessionResponse(BaseModel):
    id: str
    branch_name: str
    user_id: str
    created_at: str | None = None
    origin_commit_id: str | None = None
    origin_branch: str | None = None
    checkout_mode: str | None = None
    reconstructed_at: str | None = None


class BranchResponse(BaseModel):
    name: str
    created_at: str | None = None
    created_by: str | None = None
    head_commit_id: str | None = None
    head_message: str | None = None
    branched_from_commit_id: str | None = None


class CommitResponse(BaseModel):
    id: str
    message: str
    branch_name: str
    user_id: str | None = None
    created_at: str | None = None
    summary: str | None = None
    memory_delta_count: int = 0
    parent_id: str | None = None
    parent_ids: list[str] = Field(default_factory=list)
    is_merge: bool = False
    merge_strategy: str | None = None
    merged_from_branch: str | None = None
    merge_base_commit_id: str | None = None
    conflicts_resolved: int = 0


class MemoryResponse(BaseModel):
    id: str
    type: str
    content: str
    branch_name: str
    tags: list[str] = Field(default_factory=list)
    user_id: str | None = None
    created_at: str | None = None


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    created_at: str | None = None


class DiffResponse(BaseModel):
    branch_a: str
    branch_b: str
    only_a: list[MemoryResponse] = Field(default_factory=list)
    only_b: list[MemoryResponse] = Field(default_factory=list)


class GraphNode(BaseModel):
    id: str
    label: str
    type: str | None = None
    properties: dict = Field(default_factory=dict)


class GraphEdge(BaseModel):
    source: str
    target: str
    relationship: str


class GraphResponse(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)


class TimelineEntry(BaseModel):
    commit: CommitResponse
    parent_id: str | None = None


class MergeConflictResponse(BaseModel):
    memory_a: MemoryResponse
    memory_b: MemoryResponse
    reason: str


class MergePreviewResponse(BaseModel):
    target_branch: str
    source_branch: str
    target_head_commit_id: str | None = None
    source_head_commit_id: str | None = None
    merge_base_commit_id: str | None = None
    mode: Literal["up_to_date", "fast_forward", "merge_required"]
    conflicts: list[MergeConflictResponse] = Field(default_factory=list)
    auto_merged: list[MemoryResponse] = Field(default_factory=list)
    stats: dict[str, int] = Field(default_factory=dict)


class MergeResponse(BaseModel):
    target_branch: str
    source_branch: str
    target_head_commit_id: str | None = None
    source_head_commit_id: str | None = None
    merge_base_commit_id: str | None = None
    mode: Literal["up_to_date", "fast_forward", "merge_required"]
    conflicts: list[MergeConflictResponse] = Field(default_factory=list)
    auto_merged: list[MemoryResponse] = Field(default_factory=list)
    stats: dict[str, int] = Field(default_factory=dict)
    applied: bool = False
    fast_forward_to_commit_id: str | None = None
    merge_commit: CommitResponse | None = None
    commit_id: str | None = None
    session_id: str | None = None
    applied_resolution_count: int = 0
    status: "WorkspaceStatusResponse"


class WorkspaceStatusResponse(BaseModel):
    user_id: str
    mode: Literal["attached", "detached", "uninitialized"]
    branch_name: str | None = None
    head_commit_id: str | None = None
    head_message: str | None = None
    head_summary: str | None = None
    head_parent_ids: list[str] = Field(default_factory=list)
    head_is_merge: bool = False
    session_id: str | None = None
    origin_branch: str | None = None
    origin_commit_id: str | None = None
    reconstructed_at: str | None = None
    active_memory_count: int = 0
    memory_breakdown: dict[str, int] = Field(default_factory=dict)
    summary: str


class CommitSnapshotResponse(BaseModel):
    """Full snapshot of AI memory state at a specific commit."""

    commit: CommitResponse
    branch_name: str
    parent_ids: list[str] = Field(default_factory=list)
    is_merge: bool = False
    merged_from_branch: str | None = None
    merge_base_commit_id: str | None = None

    # Memory state
    active_memories: list[MemoryResponse] = Field(default_factory=list)
    active_memory_count: int = 0
    memory_breakdown: dict[str, int] = Field(default_factory=dict)
    grouped_memories: dict[str, list[MemoryResponse]] = Field(default_factory=dict)

    # Context
    context_summary: str = ""
    reconstructed_context: str | None = None

    # Compaction
    compaction_snapshot_count: int = 0


class HealthResponse(BaseModel):
    status: str = "ok"
    neo4j: str = "unknown"


MergeResponse.model_rebuild()
