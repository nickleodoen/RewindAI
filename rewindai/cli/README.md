# RewindAI CLI

`rewind` is the terminal interface for RewindAI, the Git-for-AI-memory workflow built on top of the FastAPI backend.

## Install

```bash
pip install -e ./cli
```

Optional defaults:

```bash
export REWINDAI_API_URL=http://localhost:8000
export REWINDAI_USER=demo
```

## Core Commands

```bash
rewind status
rewind branch list
rewind branch create graphql-experiment --from HEAD --checkout
rewind checkout main
rewind checkout <commit-id>
rewind log
rewind diff main graphql-exploration
rewind chat
rewind commit -m "Captured API direction changes"
rewind merge graphql-exploration
rewind merge graphql-exploration --strategy favor-source
rewind merge graphql-exploration --strategy manual
```

## Demo-Ready Usage

Safe demo:

```bash
rewind --user demo checkout merged-demo
rewind --user demo status
rewind --user demo chat
```

Live interactive demo:

```bash
rewind --user demo checkout main
rewind --user demo diff main graphql-exploration
rewind --user demo merge graphql-exploration --strategy manual
```

## Notes

- `rewind status` shows branch, `HEAD`, workspace mode, session, and active memory count
- `rewind log --verbose` shows commit summaries and merge parents
- `rewind merge` previews first, then applies fast-forward or merge behavior just like Git
- provider failures are shown as a memory-grounded demo fallback, not as raw backend/provider text

For the full operator runbook, see the repo [README.md](../README.md).
