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
