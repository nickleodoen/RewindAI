"""Pydantic request/response models for the API."""

from pydantic import BaseModel, Field


# ─── Requests ────────────────────────────────────────────────────────────────

class CreateSnapshotRequest(BaseModel):
    sha: str
    branch: str
    commit_message: str = ""
    messages: list[dict[str, str]] = Field(
        ..., description="Conversation messages array [{role, content}]"
    )


class ChatRequest(BaseModel):
    message: str
    system_prompt: str = ""
    conversation_history: list[dict[str, str]] = Field(default_factory=list)


# ─── Responses ───────────────────────────────────────────────────────────────

class SnapshotCreatedResponse(BaseModel):
    sha: str
    summary: str


class SnapshotResponse(BaseModel):
    sha: str
    branch: str
    timestamp: str
    summary: str
    token_count: int = 0
    commit_message: str = ""


class RestoreResponse(BaseModel):
    snapshot: SnapshotResponse
    summary: str
    decisions: list[dict[str, str]] = Field(default_factory=list)
    files_discussed: list[str] = Field(default_factory=list)
    compressed_context: str = ""


class DecisionEntry(BaseModel):
    sha: str
    summary: str
    decision: str
    rationale: str = ""
    timestamp: str = ""


class SnapshotListItem(BaseModel):
    sha: str
    branch: str
    timestamp: str
    summary: str
    commit_message: str = ""


class ChatResponse(BaseModel):
    response: str
    messages: list[dict[str, str]] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    neo4j: str
    version: str
