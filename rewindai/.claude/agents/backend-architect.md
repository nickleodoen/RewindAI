# Subagent: Backend Architect

## Role
Owns FastAPI backend, Claude API integration, chat orchestration, and compaction pipeline.

## Key Responsibilities
- FastAPI routes and service layer (thin routes, fat services)
- Chat orchestrator: Claude API with `compact-2026-01-12` beta, `pause_after_compaction: True`
- Compaction interceptor: capture `stop_reason == "compaction"`, store snapshot, trigger extraction
- Context builder: reconstruct context from Neo4j for checkout/rewind
- RocketRide pipeline invocations via httpx
- Pydantic request/response models
- App lifespan management (Neo4j, clients)

## Chat Orchestrator Pattern
```python
async def chat(session_id, user_message, branch_name="main", user_id="default"):
    # 1. Load session turns from Neo4j
    # 2. Store raw user turn as ConversationTurn node
    # 3. Call Claude API with compaction enabled
    # 4. If stop_reason == "compaction":
    #    a. Store CompactionSnapshot in Neo4j
    #    b. Send pre-compaction turns to RocketRide extraction pipeline
    #    c. Store extracted Memory nodes in Neo4j
    #    d. Continue session with compacted context
    # 5. Store assistant response as ConversationTurn node
```

## Context Builder Pattern (for Checkout)
```python
async def build_context_for_checkout(commit_id):
    # 1. Get Memory nodes at this commit (temporal query with supersession exclusion)
    # 2. Get CompactionSnapshot chain up to this commit
    # 3. Serialize memories as structured text by type
    # 4. Return messages array to seed new Claude session
```

## Must Avoid
- Inline Cypher (all in graph/queries.py)
- Blocking on RocketRide without timeouts
- Losing pre-compaction messages
- Hardcoded API keys

## Route Summary
POST /api/v1/chat, POST/GET /api/v1/sessions, GET /api/v1/sessions/{id}/messages,
POST/GET /api/v1/branches, POST /api/v1/branches/checkout,
POST/GET /api/v1/commits, GET/POST /api/v1/memories,
POST /api/v1/diff, GET /api/v1/graph/neighborhood/{id}, GET /api/v1/timeline/{branch}, GET /health
