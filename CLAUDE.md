# RewindAI — Complete Claude Code Bootstrap

Paste this entire file into Claude Code (Opus). It will create CLAUDE.md, four subagent files, scaffolding, and begin implementation.

---

## INSTRUCTIONS FOR CLAUDE CODE

You are the Orchestrator (Opus) for RewindAI, a hackathon project for HackwithBay 2.0. Your first task is to create the project structure by writing the files below to disk, then begin Sprint 1.

### Step 1: Create the project

```bash
mkdir -p rewindai/{.claude/agents,backend/app/{api,graph,models,services,chat,compaction},frontend/src/{components,hooks,types,utils},pipelines,scripts}
cd rewindai
git init
```

### Step 2: Write CLAUDE.md

Write the following content to `CLAUDE.md`:

---

<FILE path="CLAUDE.md">
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
│       ├── main.py                    # FastAPI app + lifespan
│       ├── config.py                  # pydantic-settings
│       ├── api/routes.py              # All API endpoints
│       ├── graph/
│       │   ├── neo4j_client.py        # Driver singleton
│       │   ├── schema.py             # Constraints + indexes
│       │   └── queries.py            # ALL Cypher queries (never inline)
│       ├── models/schema.py           # Pydantic models
│       ├── chat/
│       │   ├── orchestrator.py        # Claude API + compaction interception
│       │   └── context_builder.py     # Rebuilds context for checkout
│       ├── compaction/
│       │   ├── interceptor.py         # Handles compaction events
│       │   └── extractor.py           # RocketRide pipeline + fallback
│       └── services/
│           └── branch_service.py      # Branch/commit/checkout/diff
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── components/{ChatPanel,GraphExplorer,BranchManager,Timeline,DiffView}.tsx
│       ├── hooks/useApi.ts
│       ├── types/index.ts
│       └── utils/cytoscape.ts
├── pipelines/                         # RocketRide pipeline definitions (JSON)
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
</FILE>

### Step 3: Write subagent files

Write these four files under `.claude/agents/`:

<FILE path=".claude/agents/backend-architect.md">
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
</FILE>

<FILE path=".claude/agents/graph-modeler.md">
# Subagent: Graph Modeler

## Role
Owns Neo4j schema, all Cypher queries, temporal/branching queries, and data integrity.

## Schema
7 node labels: Memory, CompactionSnapshot, Commit, Branch, Session, User, ConversationTurn
13 relationship types: ON_BRANCH, PARENT_OF, BRANCHED_FROM, CREATED_IN, AUTHORED_BY, DEPENDS_ON, SUPERSEDES, EXTRACTED_TO, COMPACTED_FROM, IN_SESSION, OWNED_BY, ON_BRANCH, SNAPSHOT_AT

## Critical Cypher Queries (all go in graph/queries.py)

### Memories at commit point (temporal + supersession exclusion)
```cypher
MATCH (target:Commit {id: $commitId})-[:ON_BRANCH]->(b:Branch)
MATCH (m:Memory)
WHERE m.branchName = b.name AND m.createdAt <= target.createdAt
AND NOT EXISTS {
    MATCH (m2:Memory)-[:SUPERSEDES]->(m)
    WHERE m2.branchName = b.name AND m2.createdAt <= target.createdAt
}
RETURN m ORDER BY m.createdAt ASC
```

### Compaction chain for checkout
```cypher
MATCH (target:Commit {id: $commitId})-[:ON_BRANCH]->(b:Branch)
MATCH (cs:CompactionSnapshot)
WHERE cs.branchName = b.name AND cs.createdAt <= target.createdAt
RETURN cs ORDER BY cs.createdAt ASC
```

### Branch diff
```cypher
MATCH (m:Memory) WHERE m.branchName = $branchA
AND NOT EXISTS { MATCH (m2:Memory) WHERE m2.branchName = $branchB AND m2.content = m.content }
RETURN m, 'only_a' AS side
UNION ALL
MATCH (m:Memory) WHERE m.branchName = $branchB
AND NOT EXISTS { MATCH (m2:Memory) WHERE m2.branchName = $branchA AND m2.content = m.content }
RETURN m, 'only_b' AS side
```

### Create commit with parent linking
```cypher
CREATE (c:Commit {id: $commitId, message: $message, createdAt: datetime(), userId: $userId, branchName: $branchName})
WITH c MATCH (b:Branch {name: $branchName}) CREATE (c)-[:ON_BRANCH]->(b)
WITH c, b OPTIONAL MATCH (prev:Commit)-[:ON_BRANCH]->(b) WHERE prev.createdAt < c.createdAt AND prev <> c
WITH c, prev ORDER BY prev.createdAt DESC LIMIT 1
FOREACH (_ IN CASE WHEN prev IS NOT NULL THEN [1] ELSE [] END | CREATE (c)-[:PARENT_OF]->(prev))
```

Also needed: CREATE_SESSION, STORE_TURN, GET_SESSION_TURNS, STORE_COMPACTION_SNAPSHOT, STORE_MEMORY, LINK_MEMORY_TO_COMMIT, LINK_MEMORY_DEPENDENCY, LINK_MEMORY_SUPERSEDES, LIST_MEMORIES, CREATE_BRANCH, LIST_BRANCHES, LIST_COMMITS, GRAPH_NEIGHBORHOOD, BRANCH_TIMELINE, SEARCH_MEMORIES, ENSURE_USER

## Must Avoid
- Generic "Entity" nodes — be specific
- Queries returning entire graph — always scope by branch + time
- Missing parameters (injection risk)
- Temporal queries that don't account for branch isolation
</FILE>

<FILE path=".claude/agents/frontend-builder.md">
# Subagent: Frontend Builder

## Role
Owns React frontend, Cytoscape.js graph visualization, and UX flow.

## Layout
```
┌──────────────────────────────────────────────────────┐
│  RewindAI   │  Branch: main ▾  │  Commit  │  Status  │
├─────────────┼──────────────────┴──────────┴──────────┤
│ Timeline    │              Center                     │
│ & Branches  │   Tab: Chat | Graph | Diff              │
│ ┌─────────┐ │                                         │
│ │ commit 5│ │   Chat: conversation + compaction       │
│ │ commit 4│ │         markers inline                  │
│ │ commit 3│ │   Graph: Cytoscape.js memory graph      │
│ │   ├── B │ │   Diff: side-by-side branch comparison  │
│ │ commit 2│ │                                         │
│ │ commit 1│ │                                         │
│ └─────────┘ │                                         │
└─────────────┴─────────────────────────────────────────┘
```

## Components
- **ChatPanel**: Messages with compaction markers, send input, commit button
- **BranchManager**: Branch list, commit DAG (like git log --graph), checkout/new branch buttons
- **GraphExplorer**: Cytoscape.js with nodes colored by type, edges colored by relationship
- **Timeline**: Vertical commit history with branch points
- **DiffView**: Side-by-side branch comparison, color-coded

## Cytoscape.js Config
- Layout: `cose-bilkent` for memories, `dagre` for commit DAG
- Node colors: decision=#8b5cf6, fact=#3b82f6, action_item=#f97316, question=#eab308, commit=#10b981, branch=#f43f5e, snapshot=#6366f1
- Edge colors: DEPENDS_ON=dashed purple, SUPERSEDES=red, PARENT_OF=green, BRANCHED_FROM=dashed rose
- Click node → highlight connected, show details

## Stack
React 18 + Vite + TypeScript + Tailwind CDN + Cytoscape.js + cytoscape-cose-bilkent + cytoscape-dagre
useState/useReducer only. useApi hook for all fetches. Dark theme (#0a0a0f).

## Must Avoid
- Complex state management (no Redux)
- Over-animation
- Building pages not on demo path
- Blocking UI without loading states
</FILE>

<FILE path=".claude/agents/pipeline-engineer.md">
# Subagent: Pipeline Engineer

## Role
Owns RocketRide AI pipeline design, implementation, and integration. Ensures RocketRide is deeply used — not bolted on.

## RocketRide Context
RocketRide is a pipeline engine (NOT a model) with 50+ nodes: LLM providers, chunking, extraction, OCR, etc. C++ core, Python-extensible. Pipelines defined as JSON, run via RocketRide server (Docker). Backend invokes via HTTP webhook.

```
Backend → RocketRide Server (Docker, port 8080) → Pipeline → Structured JSON → Backend → Neo4j
```

## Pipeline 1: Extraction (extraction.json)
Input: raw conversation text → Chunker (4000 chars, 200 overlap) → LLM Extract → JSON Parser
Output: JSON array of {id, type, content, tags, depends_on, supersedes}
Types: decision, fact, context, action_item, question
Fallback: Direct Claude API call with same prompt if RocketRide unavailable

## Pipeline 2: Diff (diff.json)
Input: two branch memory arrays → LLM Compare → JSON Parser
Output: {only_a, only_b, conflicts, shared}

## Pipeline 3: Context Assembly (context_assembly.json)
Input: memories + snapshots at commit → Token Budget Chunker → LLM Synthesize
Output: optimized context string (<4000 tokens) for checkout injection

## Integration
```python
async def run_pipeline(pipeline_name: str, input_data: dict) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{ROCKETRIDE_URL}/api/v1/pipelines/{pipeline_name}/run",
            json=input_data,
        )
        response.raise_for_status()
        return response.json()
```

## Must Avoid
- Using RocketRide as thin LLM wrapper (use chunking + extraction nodes)
- Pipelines > 5s (keep fast for demo)
- Unstructured output (always JSON for graph storage)
- Ignoring RocketRide's native node capabilities
</FILE>

### Step 4: Write infrastructure files

<FILE path="docker-compose.yml">
version: "3.8"
services:
  neo4j:
    image: neo4j:5-community
    ports:
      - "7474:7474"
      - "7687:7687"
    environment:
      NEO4J_AUTH: neo4j/rewindai
      NEO4J_PLUGINS: '["apoc"]'
    volumes:
      - neo4j_data:/data
  rocketride:
    image: rocketrideorg/rocketride-server:latest
    ports:
      - "8080:8080"
    volumes:
      - ./pipelines:/app/pipelines
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
volumes:
  neo4j_data:
</FILE>

<FILE path=".env.example">
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=rewindai
ANTHROPIC_API_KEY=your_key_here
ROCKETRIDE_URL=http://localhost:8080
COMPACTION_THRESHOLD=100000
# Lower to ~5000 for demo to trigger compaction faster
</FILE>

<FILE path="backend/requirements.txt">
fastapi==0.115.0
uvicorn[standard]==0.30.0
neo4j==5.25.0
pydantic==2.9.0
pydantic-settings==2.5.0
anthropic==0.52.0
httpx==0.27.0
python-dotenv==1.0.1
pytest==8.3.0
</FILE>

<FILE path=".gitignore">
.env
*.pyc
__pycache__/
node_modules/
frontend/dist/
neo4j_data/
.vscode/
*.log
.DS_Store
</FILE>

### Step 5: Begin Sprint 1

After creating all files above, execute the sprint plan:

## Sprint Plan (8 Hours)

### Sprint 1: Foundation (45 min)
1. `cp .env.example .env` — add ANTHROPIC_API_KEY
2. `docker-compose up -d` — verify Neo4j at localhost:7474
3. Create all `__init__.py` files in backend packages
4. Create `backend/app/config.py` — pydantic-settings reading from .env
5. Create `backend/app/graph/neo4j_client.py` — driver singleton
6. Create `backend/app/graph/schema.py` — all constraints/indexes from CLAUDE.md
7. Create `backend/app/graph/queries.py` — all Cypher queries from graph-modeler.md
8. Create `backend/app/main.py` — FastAPI with lifespan, CORS, health check
9. Create `backend/app/models/schema.py` — Pydantic models
10. Verify: `uvicorn app.main:app --reload` → `curl localhost:8000/health`
11. `git commit -m "sprint-1: foundation"`

### Sprint 2: Chat + Compaction Core (90 min)
1. Create `backend/app/chat/orchestrator.py` — Claude API with compaction interception (see backend-architect.md)
2. Create `backend/app/chat/context_builder.py` — context reconstruction from graph
3. Create `backend/app/api/routes.py` — chat + session endpoints
4. Test: send messages → verify ConversationTurn nodes in Neo4j
5. `git commit -m "sprint-2: chat + compaction"`

### Sprint 3: Memory Extraction Pipeline (60 min)
1. Create RocketRide pipeline JSON files in `pipelines/`
2. Create `backend/app/compaction/extractor.py` — RocketRide invocation + Claude API fallback
3. Create `backend/app/compaction/interceptor.py` — compaction event → extraction → Neo4j
4. Wire into orchestrator
5. Test: chat until compaction → verify Memory nodes in Neo4j
6. `git commit -m "sprint-3: extraction pipeline"`

### Sprint 4: Branch + Commit System (60 min)
1. Create `backend/app/services/branch_service.py` — create_branch, create_commit, checkout, diff, timeline
2. Add branch/commit/checkout routes
3. **RUN THE PROOF TEST**:
   - Chat → establish facts A, B → commit "v1" → chat → establish fact C
   - Checkout "v1" → ask about C → **must not know C** → ask about A, B → **must know them**
4. `git commit -m "sprint-4: branching + checkout (proof verified)"`

### Sprint 5: Frontend Core (90 min)
1. Create frontend: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`
2. Install: `npm install react react-dom cytoscape cytoscape-cose-bilkent cytoscape-dagre`
3. Build: App.tsx (layout), ChatPanel, BranchManager, GraphExplorer, Timeline
4. Wire to API endpoints
5. `git commit -m "sprint-5: frontend"`

### Sprint 6: Demo Polish + Diff (45 min)
1. Create `scripts/seed_demo.py` — 2 users, 2 branches, 5 commits, 18 memories, REST vs GraphQL divergence
2. Build DiffView component
3. Polish loading states, error handling
4. `git commit -m "sprint-6: polish"`

### Sprint 7: Demo Rehearsal (30 min)
1. Run full demo flow
2. Re-run PROOF TEST
3. Fix remaining issues

## Rules
- Commit after every sprint. Never broken for >10 minutes.
- Critical path: **chat → compaction → extract → store → checkout → isolated context**
- Do NOT refactor working code.
- If RocketRide setup is slow, use fallback (direct Claude API extraction) and circle back.
- Lower COMPACTION_THRESHOLD to ~5000 for demo.
- Always re-run PROOF TEST after touching chat/compaction/checkout.

## The Proof Test (Run After Every Sprint That Touches Core)
This is the product's entire credibility:
1. Chat on "main" → establish facts A, B, C
2. Commit when only A, B exist → "v1"
3. Continue chatting → establish fact C
4. Checkout "v1"
5. Ask about C → Claude must NOT know C
6. Ask about A, B → Claude must know them correctly
If this fails, the product is vapor.

## Demo Flow for Judges
1. Alice chats → memories appear in graph
2. Commits "Initial architecture"
3. Bob joins same branch → his AI has Alice's context
4. Decide on REST API → commit "API design — REST chosen"
5. Later: "What if we'd gone with GraphQL?"
6. Branch from that commit → "graphql-exploration"
7. Checkout → Claude's context rewinds exactly to that moment
8. Ask "what did we decide about the API?" → doesn't know REST was chosen
9. Make GraphQL decision on new branch
10. Diff main vs graphql-exploration → visual side-by-side
11. SUPERSEDES relationships show exactly which decisions changed

## Demo Seed Data (for seed_demo.py)
- Users: Alice Chen, Bob Kumar
- Branch "main": 5 commits (tech stack, DB schema, REST chosen, frontend, CI/CD)
- Branch "graphql-exploration": branched from commit-003, 1 commit (GraphQL chosen)
- 14 memories on main (decisions, facts, action items, questions)
- 4 memories on graphql-exploration (GraphQL decision supersedes REST, Apollo supersedes Tanstack Query)
- Key relationships: SUPERSEDES between branches, DEPENDS_ON within
- 3 CompactionSnapshots across sessions

---

Now begin. Read CLAUDE.md, create all files, start Sprint 1.

