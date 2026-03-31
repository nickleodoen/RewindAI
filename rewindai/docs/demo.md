# RewindAI Demo Runbook

## Quick Start

```bash
# 1. Infrastructure
docker compose up -d

# 2. Backend
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000

# 3. Frontend
cd frontend && npm run dev

# 4. CLI
pip install -e ./cli
export REWINDAI_API_URL=http://localhost:8000
export REWINDAI_USER=demo
```

## Demo Commands

All demo operations are under `rewind demo`:

| Command | What it does |
|---------|-------------|
| `rewind demo prepare` | Reset to known-good state, seed data, verify |
| `rewind demo verify` | Smoke-test every demo-critical endpoint |
| `rewind demo safe` | Attach to pre-merged branch, print safe flow |
| `rewind demo live` | Attach to main, print live interactive flow |
| `rewind demo script` | Print the full 90s and 2min presenter scripts |
| `rewind demo reset` | Alias for prepare |

One-shot chat:

```bash
rewind --user demo ask "What API direction did we land on?"
```

## Pre-Demo Checklist

```bash
rewind demo prepare     # seeds data, verifies everything
rewind demo verify      # green checklist of all endpoints
rewind demo safe        # attaches to merged-demo, prints flow
```

Open http://localhost:5173 in the browser.

## Safe Demo Flow (90 seconds)

Use this for the lowest-risk demo. The merged-demo branch has all data pre-merged.

### Terminal

```bash
rewind --user demo status
rewind --user demo ask "What API direction did we land on?"
```

### Browser (http://localhost:5173)

1. **Graph tab** — show the merge diamond in the DAG on merged-demo
2. **Diff tab** — compare main vs graphql-exploration (REST vs GraphQL)
3. **Timeline sidebar** — click the merge commit to open the Snapshot Inspector
4. **Snapshot Inspector** — show grouped memories (decisions, facts, action items)
5. **Chat tab** — ask: "What API direction did we land on?"

### Spoken Track

- "This is Git for AI memory, not just a chatbot."
- "The AI's memory has real commits, branches, and merge commits."
- "Click any commit to inspect exactly what the AI knew at that point."
- "The answer is grounded in merged team knowledge — not raw chat."

## Live Interactive Demo Flow (2 minutes)

Use this to show the mechanics live.

### Terminal

```bash
rewind --user demo status
rewind --user demo log
rewind --user demo diff main graphql-exploration
rewind --user demo merge graphql-exploration --strategy manual
```

Suggested resolution: "Use REST for public APIs and GraphQL for internal graph-heavy workflows."

### Browser

1. Show the graph before merge
2. Switch to diff and explain the conflict
3. Complete the CLI merge
4. Refresh the browser — show the new merge diamond
5. Ask the chat panel: "What API direction did we land on?"

### Spoken Track

- "These are two divergent memory timelines — one chose REST, the other explored GraphQL."
- "Merging AI memory works like Git: preview conflicts, resolve them, create a merge commit."
- "The graph now shows the merged cognitive timeline as a diamond commit in the DAG."

## Snapshot Inspector Demo

This is one of the strongest demo moments:

1. Click any commit in the Timeline sidebar
2. The Snapshot Inspector shows:
   - Commit metadata (id, timestamp, branch, parents)
   - AI memory state summary ("AI knew 7 memories: 2 decisions, 3 facts...")
   - Expandable memory groups by type
   - Reconstructed context prompt
3. Click **"Rewind chat to this snapshot"**
4. The app enters detached mode and switches to Chat
5. Ask a question — the answer is grounded in that historical memory state
6. The AI does NOT know about facts from later commits

## Rescue Path

If anything breaks during a live demo:

```bash
rewind demo safe
```

This switches to the pre-merged branch instantly. Continue from the browser.

## Troubleshooting

### Backend not reachable

```bash
curl http://localhost:8000/health
```

If this fails, restart: `cd backend && uvicorn app.main:app --reload`

### Neo4j not connected

```bash
docker compose up -d
```

Then restart the backend.

### Frontend blank or stale

```bash
cd frontend && npm run dev
```

Refresh the browser.

### Demo data looks wrong

```bash
rewind demo prepare
```

### Chat shows fallback instead of live response

This degrades gracefully. The memory-grounded fallback still demonstrates the core product.
Explain: "RewindAI remains historically grounded even when the live model layer is unavailable."

### Detached mode after rewind

This is normal. After "Rewind chat to this snapshot," the workspace enters detached mode.
The Diff tab shows a clean info state instead of errors. To return to normal:

```bash
rewind --user demo checkout merged-demo
```

Or click a branch in the Branch Manager sidebar.
