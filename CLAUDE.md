# CLAUDE.md — RewindAI VS Code Extension

## What This Is
RewindAI is a VS Code extension that gives AI coding agents version-controlled memory tied to git commits. Context auto-saves on commit, auto-restores on checkout. No manual snapshots, no manual restores — everything is automatic.

## Architecture

```
┌─────────────────────────────────────────────────┐
│           VS Code Extension (TypeScript)         │
│  @rewind Chat │ GitWatcher │ ContextManager      │
└──────────────────────┬──────────────────────────┘
                       │ HTTP API
┌──────────────────────┴──────────────────────────┐
│              FastAPI Backend (Python)             │
│  Snapshot Service │ Context Service │ Decisions   │
└──────┬─────────────────┬──────────────┬─────────┘
       │                 │              │
  ┌────┴────┐     ┌──────┴──────┐  ┌───┴──────────┐
  │  Neo4j  │     │  Anthropic  │  │  .rewind/    │
  │(queries)│     │  Claude API │  │  (snapshots) │
  └─────────┘     └─────────────┘  └──────────────┘
```

## How It Works
1. Developer chats with `@rewind` in VS Code's chat panel
2. The agent (Claude via API) answers questions, tracks conversation
3. On `git commit`: GitWatcher detects it → ContextManager writes `.rewind/snapshots/{sha}.json` → also indexes in Neo4j
4. On `git checkout`: GitWatcher detects it → ContextManager reads `.rewind/snapshots/{sha}.json` → injects into system prompt
5. Agent answers based on what it knew at that commit. Nothing more.

## Key Design: .rewind/ File Storage
Context snapshots are stored as JSON files in `.rewind/snapshots/` in the repo root:
- **Files travel with the repo** — can be committed, branched, shared
- **Works offline** — no backend needed for basic snapshot/restore
- **Neo4j indexes** the files for cross-commit queries (which commits discussed this file? what decisions led here?)
- **Default `.gitignore`** in `.rewind/` excludes snapshots (private). Users can remove it to share team context.

## Project Structure
```
rewindai/
├── CLAUDE.md
├── extension/           # VS Code extension (TypeScript)
│   ├── package.json     # Extension manifest with @rewind chat participant
│   └── src/
│       ├── extension.ts            # Activation — detects git, initializes
│       ├── chat/participant.ts     # @rewind handler — /history, /status, general chat
│       ├── context/manager.ts      # Core: .rewind/ file read/write, context tracking
│       ├── git/watcher.ts          # Auto-snapshot on commit, auto-restore on checkout
│       ├── git/types.ts            # VS Code git extension API types
│       ├── backend/client.ts       # HTTP client to backend
│       └── backend/types.ts        # Shared types (snake_case matching backend)
├── backend/             # FastAPI + Neo4j
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── api/routes.py
│       ├── graph/{neo4j_client,schema,queries}.py
│       ├── models/schema.py
│       └── services/{snapshot,context,decision}_service.py
├── pipelines/           # RocketRide pipeline JSONs
├── docker-compose.yml   # Neo4j + RocketRide
└── scripts/
    └── seed-demo.py     # Demo data seeder
```

## Automatic Behavior + User Commands
- **On git commit**: GitWatcher fires → ContextManager.saveSnapshot() → writes .rewind/snapshots/{sha}.json + indexes in Neo4j
- **On git checkout**: GitWatcher fires → ContextManager.loadSnapshotForCommit() → reads .rewind/snapshots/{sha}.json → injects into chat system prompt
- **Production commands**: `/rewind <desc>` (find+restore commit + generate mega context), `/context` (show what AI knows), `/export` (portable .md for any AI), `/forget` (clear conversation, keep snapshots)
- **Internal/debug commands** (hidden from UI, still work): `/sessions`, `/graph`, `/why`, `/suggest`, `/status`, `/whatchanged`
- **Mega context export**: Generates a portable .md file the user can paste into Claude Code, ChatGPT, or any AI to continue working
- **Session notes capture LLM reasoning**: When the LLM explains what it's about to do before tool calls, that reasoning is captured in session notes

## Coding Conventions

### TypeScript (Extension)
- Strict mode. No `any` without comment.
- Use VS Code APIs idiomatically — disposables, event subscriptions
- Chat participant streams responses (not block)
- All backend calls through `backend/client.ts`
- Git operations through VS Code's git extension API, NOT child_process
- Types match backend JSON (snake_case field names)

### Python (Backend)
- Python 3.11+, type hints everywhere
- FastAPI with APIRouter prefix `/api/v1`
- All Cypher in `graph/queries.py`, never inline
- Pydantic v2 for all schemas
- `logging` not `print`
- Extraction is best-effort — snapshot creation never fails due to extraction error

### Neo4j
- Node labels: CommitSnapshot, ContextBlock, Decision, FileNode, Branch, Author
- Relationships: PARENT_OF, ON_BRANCH, CONTAINS_CONTEXT, DISCUSSED, MADE_DECISION, DEPENDS_ON, SUPERSEDES, MODIFIED_IN, AUTHORED_BY, BRANCHED_FROM
- Properties: camelCase
- Neo4j is for INDEXING and QUERYING — primary storage is .rewind/ files

### Design Principles
1. **Git-native**: Context snapshots tied to commit SHAs. No separate versioning.
2. **Automatic**: No manual snapshot/restore. Follows git state automatically.
3. **File-first**: .rewind/snapshots/ is the source of truth. Neo4j indexes for queries.
4. **No hallucination by construction**: Restored agents only see stored context.
5. **Offline-capable**: Works without backend for basic snapshot/restore.
6. **VS Code native**: Chat participant API only. No custom webviews.
