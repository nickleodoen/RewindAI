# CLAUDE.md — RewindAI

## What This Is
RewindAI is "git for AI memory." A versioned, branching knowledge graph that gives teams shared AI context with the ability to commit, branch, diff, checkout, and merge their collective understanding at any point in time.

When a team member says "go back to the architecture decision from two weeks ago and try the other path," RewindAI checks out that point in the memory graph, and every team member's AI session snaps to that exact historical context — with zero contamination from later conversations.

## Why This Exists
Claude's memory is lossy. Conversations compact. Context disappears. Teams can't sync their AI understanding. Nobody can rewind to a decision point and explore the road not taken. RewindAI solves all of this by owning the memory layer underneath the AI — making it versioned, branching, and team-shared.

Nobody does this today. Mem0, Supermemory, Zep, Cognee — they all treat memory as append-forward. None let you branch, rewind, or sync a team to a historical point. Gemini has conversation branching but it's single-user and doesn't touch the memory graph.

## Hackathon Context
- **Event**: HackwithBay 2.0
- **Required tech**: Neo4j (primary database) + RocketRide AI (core pipeline engine)
- **Stack**: Python/FastAPI + Neo4j + React/Vite/TypeScript + Cytoscape.js + RocketRide AI + Anthropic Claude API
- **Timeline**: 8-hour MVP, 2-3 day stretch

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              React Frontend (Vite + TypeScript)       │
│  Chat │ Graph Explorer │ Timeline │ Branch Manager    │
│                    Cytoscape.js                       │
└────────────────────────┬─────────────────────────────┘
                         │ REST API
┌────────────────────────┴─────────────────────────────┐
│                   FastAPI Backend                     │
│  Chat Orchestrator → Compaction Engine → Graph Store  │
│                    → Branch Manager                   │
└───────┬──────────────┬──────────────┬────────────────┘
        │              │              │
   ┌────┴────┐  ┌──────┴──────┐  ┌───┴────────────┐
   │  Neo4j  │  │  Anthropic  │  │  RocketRide AI │
   │ (graph) │  │  Claude API │  │  (pipelines)   │
   └─────────┘  └─────────────┘  └────────────────┘
```

### How Each Tech Is Used — Deeply

**Neo4j** is the versioned memory graph:
- Memory nodes (facts, decisions, context) with timestamps and branch tags
- CompactionSnapshot nodes as first-class graph nodes linked to source memories
- Branch/commit metadata modeled as graph nodes with PARENT_OF/BRANCHED_FROM relationships
- Team member attribution (who contributed which memory)
- Temporal traversal queries (graph state at time T on branch B)
- SUPERSEDES relationships for fact updates, DEPENDS_ON for decision dependencies

**Anthropic Claude API** with server-side compaction (`compact-2026-01-12` beta):
- Conversational AI that users interact with
- Server-side compaction with `pause_after_compaction: True` to intercept compaction events
- When compaction fires, we capture the compaction block AND pre-compaction raw messages
- Both stored in Neo4j as linked nodes
- On checkout/rewind, context reconstructed from graph and injected into a NEW Claude API session — provably isolated

**RocketRide AI** orchestrates intelligence pipelines (NOT a model — a pipeline engine with 50+ nodes, C++ core, LLM providers, chunking, extraction):
- **Extraction pipeline**: Raw conversation → chunking → LLM extraction → structured Memory JSON
- **Diff pipeline**: Two branch memory sets → LLM comparison → structured diff
- **Context assembly pipeline**: Memories + snapshots at a commit → token-budgeted synthesis → optimized context for checkout
- **Merge pipeline** (stretch): Conflict resolution when merging branches
- Backend invokes pipelines via HTTP webhook to RocketRide server
- Fallback: Direct Claude API calls if RocketRide is unavailable

### Data Flow
1. User chats → FastAPI → Claude API (with compaction enabled)
2. When compaction triggers (`stop_reason == "compaction"`):
   a. Capture compaction block, store as CompactionSnapshot in Neo4j
   b. Send pre-compaction messages through RocketRide extraction pipeline
   c. Store extracted Memory nodes (decisions, facts, etc.) in Neo4j
   d. Continue session with compacted context
3. User commits → memory state snapshotted as Commit node in Neo4j
4. User branches from commit X → new Branch node, BRANCHED_FROM relationship
5. User checks out branch/commit → context rebuilt from that point, new Claude session
6. User diffs branches → RocketRide diff pipeline shows divergence

## Folder Structure
```
rewindai/
├── CLAUDE.md
├── docker-compose.yml
├── .env.example
├── .claude/agents/
│   ├── backend-architect.md
│   ├── graph-modeler.md
│   ├── frontend-builder.md
│   └── pipeline-engineer.md
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── api/routes.py
│       ├── graph/
│       │   ├── neo4j_client.py
│       │   ├── schema.py
│       │   └── queries.py
│       ├── models/schema.py
│       ├── chat/
│       │   ├── orchestrator.py
│       │   └── context_builder.py
│       ├── compaction/
│       │   ├── interceptor.py
│       │   └── extractor.py
│       └── services/
│           └── branch_service.py
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── components/{ChatPanel,GraphExplorer,BranchManager,Timeline,DiffView}.tsx
│       ├── hooks/useApi.ts
│       ├── types/index.ts
│       └── utils/cytoscape.ts
├── pipelines/
│   ├── extraction.json
│   ├── diff.json
│   └── context_assembly.json
└── scripts/seed_demo.py
```

## Coding Conventions

**Python**: Python 3.11+, type hints everywhere, Pydantic v2, thin routes/fat services, ALL Cypher in `graph/queries.py`, Neo4j driver singleton, `anthropic` SDK for Claude, `httpx` for RocketRide, config via pydantic-settings, `logging` not `print`, `snake_case`.

**TypeScript**: React 18 functional+hooks only, strict mode, PascalCase components, `useApi` hook for all fetches, Tailwind CDN, useState/useReducer only.

**Neo4j**:
- Node labels (PascalCase singular): Memory, CompactionSnapshot, Commit, Branch, Session, User, ConversationTurn
- Relationships (SCREAMING_SNAKE_CASE): ON_BRANCH, PARENT_OF, BRANCHED_FROM, CREATED_IN, AUTHORED_BY, DEPENDS_ON, SUPERSEDES, EXTRACTED_TO, COMPACTED_FROM, IN_SESSION, OWNED_BY, SNAPSHOT_AT
- Properties (camelCase): createdAt, branchName, tokenCount, etc.
- Constraints: Unique on Memory.id, Commit.id, Branch.name, Session.id, User.id, CompactionSnapshot.id, ConversationTurn.id
- Indexes: Memory.createdAt, Memory.type, Commit.createdAt, CompactionSnapshot.createdAt
- Full-text index on Memory.content

## Critical Technical Detail: Claude API Compaction

```python
response = client.beta.messages.create(
    betas=["compact-2026-01-12"],
    model="claude-sonnet-4-6",
    max_tokens=4096,
    messages=messages,
    context_management={
        "edits": [{
            "type": "compact_20260112",
            "trigger": {"type": "input_tokens", "value": settings.compaction_threshold},
            "pause_after_compaction": True,
            "instructions": "Preserve: decisions+rationale, facts, open questions, action items, dependencies."
        }]
    },
)
if response.stop_reason == "compaction":
    compaction_block = response.content[0]
    # 1. Store in Neo4j as CompactionSnapshot
    # 2. Send pre-compaction messages to RocketRide extraction
    # 3. Store extracted Memory nodes
    # 4. Continue: messages = [{"role": "assistant", "content": [compaction_block]}]
```

## Checkout Flow
1. Query Neo4j: all Memory nodes on branch where createdAt <= commit.createdAt, excluding SUPERSEDED
2. Query Neo4j: CompactionSnapshot chain up to commit
3. Serialize memories as structured context, use latest snapshot as conversation seed
4. Start NEW Claude API session with this context — Claude knows nothing beyond this point
5. PROOF TEST: Ask about post-checkout facts → Claude must not know them

## API Routes
```
POST /api/v1/chat                    — send message (with compaction)
POST /api/v1/sessions                — create session on branch
GET  /api/v1/sessions                — list sessions
GET  /api/v1/sessions/{id}/messages  — conversation history
POST /api/v1/branches                — create branch from commit
GET  /api/v1/branches                — list branches
POST /api/v1/branches/checkout       — checkout branch/commit → new session
POST /api/v1/commits                 — commit current state
GET  /api/v1/commits?branch_name=    — list commits
GET  /api/v1/memories?branch_name=   — list memories
POST /api/v1/memories                — manual memory creation
POST /api/v1/diff                    — diff two branches
GET  /api/v1/graph/neighborhood/{id} — graph for Cytoscape.js
GET  /api/v1/timeline/{branch}       — commit timeline
GET  /health                         — health check
```

## Design Principles
1. **Graph-versioned**: Every memory is a node with timestamp, branch, author. The graph IS the version history.
2. **Compaction-faithful**: Intercept Claude's own compaction, store it. Don't reinvent — extend.
3. **Provably isolated**: On checkout, Claude gets ONLY that point's context. API is the control boundary.
4. **Team-native**: Multiple users, shared branches, attributed memories.
5. **Demo-driven**: Every feature must produce a visible demo moment.
6. **Pipeline-powered**: RocketRide handles extraction/diff/assembly. Claude handles conversation.

## Subagent Delegation
| Task | Subagent |
|------|----------|
| FastAPI, services, Claude API, compaction | `backend-architect` |
| Neo4j schema, Cypher, temporal queries | `graph-modeler` |
| React, Cytoscape, UI/UX | `frontend-builder` |
| RocketRide pipelines, extraction, diff | `pipeline-engineer` |
