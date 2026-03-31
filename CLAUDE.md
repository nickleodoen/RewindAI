# CLAUDE.md — RewindAI VS Code Extension

## What This Is
RewindAI is a VS Code extension that gives AI coding agents version-controlled memory tied to git commits. When you commit, RewindAI snapshots the agent's full context. When you checkout a past commit, RewindAI restores the agent to the exact state it was in — same knowledge, same reasoning, same decisions. No hallucination, no context loss.

## Architecture

```
┌─────────────────────────────────────────────────┐
│           VS Code Extension (TypeScript)         │
│  @rewind Chat Participant │ Git Watcher │ Hooks  │
└──────────────────────┬──────────────────────────┘
                       │ HTTP API
┌──────────────────────┴──────────────────────────┐
│              FastAPI Backend (Python)             │
│  Snapshot Service │ Context Service │ Decisions   │
└──────┬─────────────────┬──────────────┬─────────┘
       │                 │              │
  ┌────┴────┐     ┌──────┴──────┐  ┌───┴──────────┐
  │  Neo4j  │     │  Anthropic  │  │  RocketRide  │
  │ (graph) │     │  Claude API │  │  (pipelines) │
  └─────────┘     └─────────────┘  └──────────────┘
```

## How It Works
1. Developer chats with `@rewind` in VS Code's chat panel
2. The agent (Claude via API) reads files, discusses changes, makes decisions
3. On `git commit`: extension captures the messages array (the agent's full state)
4. Messages are sent to RocketRide extraction pipeline → structured summary + decisions
5. Full context + metadata stored in Neo4j, keyed to the commit SHA
6. On `git checkout <old-commit>`: extension queries Neo4j for that SHA's snapshot
7. A new Claude API session is started with the stored messages → agent is restored
8. The agent answers questions based on what it knew at that commit. Nothing more.

## Project Structure
```
rewindai/
├── CLAUDE.md
├── extension/           # VS Code extension (TypeScript)
│   ├── package.json     # Extension manifest with chat participant
│   └── src/
│       ├── extension.ts            # Activation + registration
│       ├── chat/participant.ts     # @rewind handler
│       ├── chat/commands.ts        # /snapshot, /restore, /why, /decisions
│       ├── chat/prompts.ts         # System prompts
│       ├── context/capturer.ts     # Capture context on commit
│       ├── context/restorer.ts     # Restore context on checkout
│       ├── git/watcher.ts          # Git event detection
│       ├── git/hooks.ts            # Git hook management
│       ├── backend/client.ts       # HTTP client to backend
│       └── backend/types.ts        # Shared types
├── backend/             # FastAPI + Neo4j + RocketRide
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
```

## Coding Conventions

### TypeScript (Extension)
- Strict mode. No `any` without comment.
- Use VS Code APIs idiomatically — disposables, event subscriptions, command registration
- Chat participant handler must stream responses (not block)
- All backend calls through `backend/client.ts`
- Git operations through VS Code's git extension API, NOT child_process

### Python (Backend)
- Python 3.11+, type hints everywhere
- FastAPI with APIRouter prefix `/api/v1`
- All Cypher in `graph/queries.py`, never inline
- Pydantic v2 for all schemas
- `logging` not `print`

### Neo4j
- Node labels: CommitSnapshot, ContextBlock, Decision, FileNode, Branch, Author
- Relationships: PARENT_OF, ON_BRANCH, CONTAINS_CONTEXT, DISCUSSED, MADE_DECISION, DEPENDS_ON, SUPERSEDES, MODIFIED_IN, AUTHORED_BY, BRANCHED_FROM
- Properties: camelCase
- Constraints: Unique on CommitSnapshot.sha, Branch.name, Decision.id, FileNode.path
- Context blocks stored with sequence numbers for ordered reconstruction

### Design Principles
1. **Git-native**: Context snapshots are tied to commit SHAs. No separate versioning system.
2. **Context = Messages Array**: The agent's state is fully captured by the messages sent to the Claude API.
3. **No hallucination by construction**: Restored agents only see the stored context.
4. **Neo4j for relationships**: Commits, decisions, and files form a graph.
5. **RocketRide for processing**: Raw context is too large to store verbatim.
6. **VS Code native**: Use the chat participant API. No custom webviews.

## Subagent Delegation
| Task | Subagent |
|------|----------|
| Extension structure, VS Code APIs, chat participant | `extension-architect` |
| Context capture, restore, compression, messages array | `context-engine` |
| Neo4j schema, Cypher queries, graph design | `graph-modeler` |
| RocketRide pipelines, extraction, compression | `pipeline-engineer` |
