"""Pydantic models for request/response schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ── Requests ──────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    session_id: str
    message: str
    user_id: str = "default"


class CreateSessionRequest(BaseModel):
    branch_name: str = "main"
    user_id: str = "default"


class CreateBranchRequest(BaseModel):
    branch_name: str
    source_commit_id: str | None = None
    user_id: str = "default"


class CheckoutRequest(BaseModel):
    branch_name: str
    commit_id: str | None = None
    user_id: str = "default"


class CreateCommitRequest(BaseModel):
    branch_name: str = "main"
    message: str = ""
    user_id: str = "default"


class CreateMemoryRequest(BaseModel):
    type: Literal["decision", "fact", "context", "action_item", "question"]
    content: str
    branch_name: str = "main"
    user_id: str = "default"
    tags: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    supersedes: list[str] = Field(default_factory=list)


class DiffRequest(BaseModel):
    branch_a: str
    branch_b: str


# ── Responses ─────────────────────────────────────────────────────────────────

class ChatResponse(BaseModel):
    session_id: str
    response: str
    compaction_occurred: bool = False
    memories_extracted: int = 0


class SessionResponse(BaseModel):
    id: str
    branch_name: str
    user_id: str
    created_at: str | None = None


class BranchResponse(BaseModel):
    name: str
    created_at: str | None = None
    created_by: str | None = None


class CommitResponse(BaseModel):
    id: str
    message: str
    branch_name: str
    user_id: str | None = None
    created_at: str | None = None


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


class HealthResponse(BaseModel):
    status: str = "ok"
    neo4j: str = "unknown"
