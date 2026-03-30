# RewindAI Demo Runbook

This is the fastest way to get RewindAI into a known-good judge-ready state.

## One-Time Setup

### Infrastructure

```bash
docker compose up -d
```

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### CLI

```bash
pip install -e ./cli
```

Optional environment defaults:

```bash
export REWINDAI_API_URL=http://localhost:8000
export REWINDAI_USER=demo
```

## Reset To The Known Demo State

```bash
./scripts/reset_demo.sh
```

Expected result:

- `main`, `graphql-exploration`, and `merged-demo` exist
- the demo workspace is attached to `main`
- `merged-demo` contains a merge commit
- diff and merge-preview are non-empty and legible
- chat fallback is verified

## Safe Demo Flow

Use this when you want the lowest-risk demo.

### Terminal

```bash
rewind --user demo checkout merged-demo
rewind --user demo status
```

### Browser

Open `http://localhost:5173`.

Show:

1. branch / `HEAD` / workspace mode in the top bar
2. graph tab on `merged-demo`
3. merge diamond in the graph
4. diff tab comparing `main` vs `graphql-exploration`
5. chat tab asking: `What API direction did we land on?`

### Spoken track

- “This is Git for AI memory, not just a chatbot.”
- “Here the AI’s memory has real commits, branches, and a merge commit.”
- “The merged branch knows both reasoning paths and the final reconciliation.”

## Live Interactive Demo Flow

Use this when you want to show the mechanics live.

### Terminal

```bash
rewind --user demo checkout main
rewind --user demo status
rewind --user demo log
rewind --user demo diff main graphql-exploration
rewind --user demo merge graphql-exploration --strategy manual
```

Suggested manual resolution:

```text
Use REST for public APIs and GraphQL for internal graph-heavy workflows.
```

### Browser

Open `http://localhost:5173` and:

1. stay on `main`
2. show the graph before merge
3. switch to diff and explain the conflict
4. complete the CLI merge
5. refresh the browser graph and show the new merge diamond
6. ask the chat panel what API direction the team landed on

## Presenter Script

### Step 1

Action:

```bash
rewind --user demo status
```

Say:

> RewindAI gives the model a real workspace HEAD, so we always know exactly what memory state the AI is operating from.

### Step 2

Action:

```bash
rewind --user demo diff main graphql-exploration
```

Say:

> These are two different memory timelines: one chose REST, the other explored GraphQL.

### Step 3

Action:

```bash
rewind --user demo merge graphql-exploration --strategy manual
```

Say:

> Merging AI memory works like Git: we preview conflicts, resolve them, and create a true two-parent merge commit.

### Step 4

Action:

- switch to the browser graph

Say:

> The graph now shows the merged cognitive timeline as a diamond commit in the DAG.

### Step 5

Action:

- ask the chat panel: `What API direction did we land on?`

Say:

> The answer is grounded in the merged memory world, not just the latest raw chat.

## Troubleshooting

### Backend not reachable

```bash
curl http://localhost:8000/health
```

If this fails, restart the backend.

### Neo4j not connected

```bash
docker compose up -d
```

Then restart the backend.

### Frontend blank or stale

```bash
cd frontend
npm run dev
```

Refresh the browser.

### Demo data looks wrong

```bash
./scripts/reset_demo.sh
```

### Provider failure during chat

That is expected to degrade gracefully.

You should see a memory-grounded fallback notice instead of raw provider error text. Continue the demo and explain that RewindAI remains historically grounded even when the live model layer is unavailable.
