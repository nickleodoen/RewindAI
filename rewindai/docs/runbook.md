# RewindAI Presentation Runbook

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
export REWINDAI_USER=presenter
```

## Operator Commands

| Command | Purpose |
|---------|---------|
| `rewind showcase prepare` | Reset to known-good state, seed data, verify |
| `rewind showcase verify` | Smoke-test every critical endpoint |
| `rewind showcase ready` | Attach to pre-merged branch, print safe flow |
| `rewind showcase live` | Attach to main, print interactive flow |
| `rewind showcase script` | Print full presenter scripts |
| `rewind showcase reset` | Alias for prepare |

## Pre-Presentation Checklist

```bash
rewind showcase prepare     # seeds data, verifies everything
rewind showcase verify      # green checklist of all endpoints
rewind showcase ready       # attaches to merged, prints flow
```

## Interactive Shell

The shell is the primary presentation interface:

```bash
rewind --user presenter chat
```

Inside the shell, type `guide` for the recommended flow or `help` for all commands.

### Key Shell Commands

| Command | What it does |
|---------|-------------|
| `status` | Workspace overview |
| `branches` | Three branches, three perspectives |
| `diff main graphql-exploration` | Side-by-side memory divergence |
| `timeline` | Commit history with merge badges |
| `snapshot HEAD` | Full agent memory state at a commit |
| `rewind <commit>` | Time-travel to a historical point |
| `context` | What the AI knows right now |
| `ask <question>` | Query from current memory state |
| `project` | Show linked project workspace |
| `guide` | Recommended presentation flow |
| `back` | Return to previous branch after rewind |

## Safe Flow (90 seconds)

Lowest-risk presentation path. Uses the `merged` branch with pre-merged data.

```
rewind --user presenter chat

Inside the shell:
  use merged
  status
  diff main graphql-exploration
  timeline
  snapshot HEAD
  ask What API direction did we land on?
```

The answer is grounded in merged team knowledge — decisions, facts, and context from both branches.

## Time-Travel Flow (the wow moment)

```
rewind <early-commit-id>       # go back in time
context                        # see what the AI knows
ask What did we decide about the API?  # doesn't know later decisions
back                           # return to the present
ask What API direction did we land on? # now it knows
```

## Browser

The browser still works alongside the shell:

- **Graph tab** — merge diamond in the DAG
- **Diff tab** — side-by-side branch comparison
- **Timeline sidebar** — click commits to inspect snapshots
- **Chat tab** — conversational queries

URL: http://localhost:5173

## Snapshot Inspector

Run `snapshot HEAD` or `snapshot <commit-id>` in the shell to see:
- Commit metadata (author, timestamp, merge status)
- Agent state summary (what the AI knows at that point)
- Grouped memories by type (decisions, facts, questions)
- Project phase context
- Next-step suggestions

## Project Workspace

Run `project` in the shell to see the linked workspace:
- File tree with relevant docs highlighted
- Current branch phase
- Mapping between docs and the memory storyline

## Recovery

If anything goes wrong during presentation:

```
use merged       # inside the shell — reattach instantly
```

Or from the CLI:
```
rewind showcase ready
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Backend not reachable | `curl http://localhost:8000/health` — restart uvicorn if needed |
| Neo4j not connected | `docker compose up -d` — restart backend |
| Frontend blank | `npm run dev` in frontend/ — refresh browser |
| Data wrong | `rewind showcase prepare` |
| Chat fallback | Normal — answers remain grounded in memory graph |
| Detached mode after rewind | Expected — use `back` to return |
