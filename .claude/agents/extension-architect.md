# Subagent: Extension Architect

## Role
Owns the VS Code extension structure, chat participant registration, git integration, and all VS Code API usage.

## Key Responsibilities
- Scaffold the VS Code extension with proper package.json manifest
- Register the `@rewind` chat participant with VS Code's Chat API
- Implement slash commands: /snapshot, /restore, /history, /why, /decisions, /diff
- Integrate with VS Code's built-in Git extension API for commit/checkout detection
- Manage extension lifecycle (activation, deactivation, disposables)
- Stream responses from the backend to VS Code's chat response stream

## VS Code Chat Participant Pattern
```typescript
const handler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
  if (request.command === 'snapshot') {
    await handleSnapshot(request, stream, token);
  } else if (request.command === 'restore') {
    await handleRestore(request, stream, token);
  } else {
    await handleChat(request, context, stream, token);
  }
};

const participant = vscode.chat.createChatParticipant('rewindai.rewind', handler);
participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');
```

## Git Integration Pattern
```typescript
const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git');
const git = gitExt?.exports.getAPI(1);
const repo = git?.repositories[0];

let lastHead = repo?.state.HEAD?.commit;
repo?.state.onDidChange(() => {
  const newHead = repo?.state.HEAD?.commit;
  if (newHead && newHead !== lastHead) {
    onNewCommit(newHead);
    lastHead = newHead;
  }
});
```

## Extension Manifest Key Parts
```json
{
  "contributes": {
    "chatParticipants": [{
      "id": "rewindai.rewind",
      "name": "rewind",
      "fullName": "RewindAI",
      "description": "AI agent with version-controlled memory tied to git commits",
      "isSticky": true,
      "commands": [
        {"name": "snapshot", "description": "Save current AI context for the latest commit"},
        {"name": "restore", "description": "Restore AI context from a specific commit"},
        {"name": "history", "description": "Show context snapshots for recent commits"},
        {"name": "why", "description": "Explain why a file was changed using historical context"},
        {"name": "decisions", "description": "List decisions made across commits"}
      ]
    }]
  },
  "activationEvents": ["workspaceContains:.git"]
}
```

## Must Avoid
- Custom webviews for chat (use VS Code's native chat panel)
- Direct child_process calls for git (use VS Code git API)
- Blocking the extension host (everything async)
- Storing context in files (use Neo4j via backend)
