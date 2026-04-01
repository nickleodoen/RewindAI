# RewindAI

**Version-controlled AI memory tied to git commits.**

RewindAI is a VS Code extension that gives AI coding agents persistent, version-controlled memory. Context auto-saves on commit, auto-restores on checkout. No manual snapshots, no manual restores — everything follows your git workflow.

## The Problem

AI coding assistants forget everything between sessions. Switch branches? Context gone. Checkout an old commit? Your AI has no idea what was discussed. Come back tomorrow? Start over.

## The Solution

RewindAI ties AI memory to git commits:
- **On `git commit`**: Saves everything — conversation, decisions, files discussed, session notes
- **On `git checkout`**: Restores the exact context from that point in time
- **Smart suggestions**: Ask "go back to when we had simple auth" and RewindAI finds the right commit

## Architecture

```
VS Code Extension (TypeScript)
  |-- @rewind Chat Panel (built-in AI assistant with tools)
  |-- GitWatcher (auto-snapshot on commit, auto-restore on checkout)
  |-- ContextManager (.rewind/snapshots/{sha}.json)
  |-- Neo4j Graph Client (cross-commit queries, decision chains)
  |-- RocketRide AI Pipelines (LLM-powered enrichment & compression)

Backend Services (Docker)
  |-- Neo4j 5 Community (graph database for commit/decision/file relationships)
  |-- RocketRide Server (AI pipeline execution engine)
```

## Key Features

### Automatic Context Management
- Context snapshots stored as JSON in `.rewind/snapshots/`
- Session notes captured as markdown in `.rewind/sessions/`
- Rolling summary compaction keeps context window manageable
- No manual commands needed — follows git state automatically

### Neo4j Graph Integration
- Indexes commits, sessions, decisions, and files as graph nodes
- Cross-commit queries: "which commits discussed auth?"
- Decision chain traversal: trace how decisions evolved across commits
- `/graph` command shows connection status and stats
- `/why <file>` traces the decision history for any file

### RocketRide AI Pipelines
- **Session Enrichment**: LLM extracts structured decisions/insights from conversations
- **Context Compression**: LLM produces dense summaries (replaces regex parsing)
- **Commit Relevance Scoring**: LLM ranks commits for smart suggestions
- Graceful degradation: extension works identically without RocketRide

### Smart Commit Suggestions
- Natural language: "go back to when we had simple auth"
- Searches commit messages, snapshots, decisions, and session notes
- Neo4j-accelerated when connected, file-based fallback otherwise

### Built-in Agentic Chat
- Full tool-calling loop: read/write/edit files, run commands, search code
- Anthropic Claude or OpenAI GPT support
- Relevant context injection (only loads sessions matching your query)

## Quick Start

### 1. Install the Extension
```bash
cd extension
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

### 2. Start Backend Services (Optional)
```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start Neo4j + RocketRide
./scripts/start-services.sh

# Or manually:
docker compose up -d
```

### 3. Configure
Open the RewindAI panel (bottom panel, next to Terminal) and enter your API key in Settings. Or set in VS Code settings:
- `rewindai.provider`: `anthropic` or `openai`
- `rewindai.apiKey`: Your API key
- `rewindai.model`: Model ID (default: `claude-sonnet-4-6`)

### 4. Use It
1. Chat with the AI in the RewindAI panel
2. Make a git commit — context is automatically saved
3. Checkout a different branch/commit — context is automatically restored
4. Use `/suggest` to find commits by description
5. Use `/graph` to check Neo4j/RocketRide status
6. Use `/why <file>` to trace decision history

## Commands

| Command | Description |
|---------|-------------|
| `/suggest <query>` | Find commits matching a description |
| `/graph` | Show Neo4j/RocketRide connection status and stats |
| `/why <file>` | Trace decision chain for a file |
| `/whatchanged` | Show recent file changes |
| `/sessions` | List session notes |

## Project Structure

```
rewindai/
  extension/          # VS Code extension (TypeScript)
    src/
      extension.ts              # Activation, dependency wiring
      chat/panelProvider.ts     # WebviewView panel with chat UI
      agent/loop.ts             # Agentic tool-calling loop
      context/manager.ts        # .rewind/ file read/write
      context/sessionNotes.ts   # Per-prompt session note generation
      context/compactor.ts      # Rolling summary compaction
      context/commitSuggester.ts # Smart commit suggestion
      git/watcher.ts            # Auto-snapshot/restore on git events
      graph/neo4jClient.ts      # Direct Neo4j driver integration
      pipelines/rocketrideClient.ts # RocketRide HTTP client
      llm/client.ts             # Anthropic/OpenAI API client
      tools/executor.ts         # Tool definitions and execution
  backend/              # FastAPI + Neo4j (Python)
  docker-compose.yml    # Neo4j + RocketRide services
  scripts/
    start-services.sh   # One-command service startup
    seed-demo.py        # Demo data seeder
```

## Design Principles

1. **Git-native**: Context tied to commit SHAs. No separate versioning.
2. **Automatic**: No manual snapshot/restore. Follows git state.
3. **File-first**: `.rewind/` is source of truth. Neo4j indexes for queries.
4. **No hallucination by construction**: Restored agents only see stored context.
5. **Offline-capable**: Works without backend for basic snapshot/restore.
6. **Graceful degradation**: Neo4j/RocketRide enhance but aren't required.

## Tech Stack

- **Extension**: TypeScript, VS Code Extension API, WebviewView
- **Graph DB**: Neo4j 5 Community (via neo4j-driver npm)
- **AI Pipelines**: RocketRide Server (Anthropic Claude pipelines)
- **LLM**: Anthropic Claude / OpenAI GPT (configurable)
- **Infrastructure**: Docker Compose

## Built at HackwithBay 2.0

RewindAI was built at the HackwithBay 2.0 hackathon, leveraging Neo4j for graph-powered context queries and RocketRide AI for intelligent pipeline processing.
