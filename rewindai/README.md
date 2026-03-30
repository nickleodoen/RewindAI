# RewindAI

RewindAI is **Git for AI memory**.

It turns AI context into a versioned graph:

- memories are the durable knowledge units
- commits snapshot what the AI should know
- branches represent alternate cognitive timelines
- checkout reconstructs historically correct context
- merge combines alternate reasoning paths with Git-like conflict handling
- chat runs from the active workspace `HEAD`

This repo contains:

- `backend/` — FastAPI + Neo4j backend
- `frontend/` — Vite/React demo UI
- `cli/` — Typer/Rich command-line interface
- `scripts/` — deterministic demo reset and seed helpers

## Why It Matters

Normal AI chat loses context, rewrites decisions, and makes alternate exploration hard to compare.

RewindAI gives you:

- `git checkout`, but for AI memory state
- `git diff`, but for branch knowledge divergence
- `git merge`, but for alternate reasoning paths
- historically grounded chat from any point in the commit DAG

## Architecture

Neo4j is the source of truth.

Core graph entities:

- `Memory`
- `Commit`
- `Branch`
- `Session`
- `Workspace`
- `User`
- `ConversationTurn`
- `CompactionSnapshot`

Key product semantics:

- each user has a persistent `Workspace`
- attached mode means `HEAD` follows a branch tip
- detached mode means `HEAD` points directly at a historical commit
- merge creates a real two-parent commit in the DAG
- conflicting memories are resolved by new target-branch memories that supersede both inputs
- non-conflicting source memories come through ancestry, not by copying history

## Quick Start

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts Neo4j and RocketRide.

### 2. Run the backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 3. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

### 4. Install the CLI

```bash
pip install -e ./cli
```

Optional environment variables:

```bash
export REWINDAI_API_URL=http://localhost:8000
export REWINDAI_USER=demo
```

### 5. Reset to the deterministic demo state

```bash
./scripts/reset_demo.sh
```

That one command:

- checks backend + Neo4j readiness
- clears and reseeds the graph
- creates `main`, `graphql-exploration`, and `merged-demo`
- prebuilds a merge commit on `merged-demo`
- verifies diff, merge-preview, graph, workspace status, and chat fallback
- leaves the demo workspace attached to `main` for the live interactive path

## Demo Dataset

The seeded story is intentionally simple and presentation-friendly:

- `main` chooses a stable REST public API, JWT auth, and Redis caching
- `graphql-exploration` explores GraphQL for flexible graph-heavy queries
- the two branches conflict on the public API direction
- `graphql-exploration` also adds a non-conflicting insight about schema stitching
- `merged-demo` shows the merged result with a real diamond merge commit

This gives you:

- visible divergence in the graph
- a clean diff story
- a meaningful merge preview
- merged chat context that references both worlds

For the operator runbook version of this flow, see [docs/demo.md](docs/demo.md).

## Safe Demo Flow

Use this when time is short or the environment feels risky.

### Terminal

```bash
rewind --user demo checkout merged-demo
rewind --user demo status
```

### Browser

Open `http://localhost:5173`.

Then show:

1. the top bar with branch, `HEAD`, workspace mode, and session
2. the graph tab with the merge diamond on `merged-demo`
3. the diff tab comparing `main` vs `graphql-exploration`
4. the chat tab on `merged-demo`, showing the merged memory world

Why this is safe:

- the merge commit is already present
- the graph already contains the diamond
- chat has a backend-owned memory-grounded fallback if the provider is unavailable

## Live Interactive Demo Flow

Use this when you want the higher-wow-factor branch/merge story.

### Terminal

```bash
rewind --user demo checkout main
rewind --user demo status
rewind --user demo log
rewind --user demo diff main graphql-exploration
rewind --user demo merge graphql-exploration --strategy manual
```

### Browser

Open `http://localhost:5173` and narrate:

1. rewind to an earlier memory state
2. compare `main` and `graphql-exploration`
3. explain the merge preview conflict
4. show the merge commit in the graph after the merge
5. chat from the merged state

## Scripted Walkthrough

Use the lines below as a presentation script.

### Moment 1 — establish the concept

Action:

```bash
rewind --user demo status
```

What the audience sees:

- current branch
- current `HEAD`
- whether the workspace is attached or detached
- how many active memories the AI sees

What to say:

> RewindAI gives AI memory a real Git-like workspace, so we can inspect, rewind, branch, and merge what the model knows.

### Moment 2 — show divergence

Action:

```bash
rewind --user demo diff main graphql-exploration
```

What the audience sees:

- `main` keeps the REST direction
- `graphql-exploration` keeps the GraphQL direction
- the divergence is readable without raw JSON

What to say:

> These two branches represent alternate reasoning timelines, and the diff makes the knowledge divergence explicit.

### Moment 3 — show the graph

Action:

- open the browser
- stay on the graph tab
- switch to `merged-demo`

What the audience sees:

- branch divergence
- a diamond merge commit
- readable labels and visible merge state

What to say:

> This is not just a chat log. It is a real commit DAG for AI memory, including a merge commit with two parents.

### Moment 4 — show merged cognition

Action:

- open the chat tab on `merged-demo`
- ask: `What API direction did we land on?`

What the audience sees:

- a historically grounded answer from the merged memory state
- if the live model is unavailable, a clean memory-grounded fallback notice instead of provider noise

What to say:

> After the merge, the AI can answer from the merged memory world rather than from one branch or the other.

## CLI Reference

Common commands:

```bash
rewind status
rewind branch list
rewind branch create graphql-experiment --from HEAD --checkout
rewind checkout main
rewind checkout <commit-id>
rewind log
rewind diff main graphql-exploration
rewind chat
rewind commit -m "Captured new direction"
rewind merge graphql-exploration
rewind merge graphql-exploration --strategy favor-source
rewind merge graphql-exploration --strategy manual
```

For more CLI notes, see [cli/README.md](cli/README.md).

## Testing

Backend integration tests:

```bash
PYTHONPATH=backend python3 -m pytest backend/tests -q
```

CLI tests:

```bash
PYTHONPATH=cli python3 -m pytest cli/tests -q
```

Python compile checks:

```bash
python3 -m compileall backend/app cli/rewindai_cli
```

Frontend build:

```bash
cd frontend
npm run build
```

## Troubleshooting

### Backend is not up

Run:

```bash
curl http://localhost:8000/health
```

You want:

- `status: ok`
- `neo4j: connected`

### Neo4j is not connected

Restart infrastructure:

```bash
docker compose up -d
```

Then restart the backend.

### Frontend is not loading

From `frontend/`:

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

### The demo state looks wrong

Run:

```bash
./scripts/reset_demo.sh
```

This is the fastest way back to the known-good narrative.

### The model/provider is failing

That should not break the demo.

RewindAI now returns a structured, memory-grounded fallback instead of surfacing raw provider failure text. You can continue the demo and explain that the system is degrading gracefully to historical memory retrieval.

## Notes

- existing frontend endpoints remain compatible
- merge commits are first-class DAG nodes with two parents
- detached chat stays historically grounded without mutating branch memory
- commits sync new session-derived memories before snapshotting
- conflict resolution never rewrites history
