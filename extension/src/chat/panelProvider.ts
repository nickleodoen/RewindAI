import * as vscode from 'vscode';
import { ContextManager } from '../context/manager';
import { BackendClient } from '../backend/client';

/**
 * Provides the RewindAI webview panel that appears as its own tab
 * in the bottom panel area (next to Terminal, Claude Code, etc.).
 */
export class RewindPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'rewindai.panel';
  private webviewView: vscode.WebviewView | undefined;
  private backend: BackendClient;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly contextManager: ContextManager,
    private readonly workspaceRoot: string,
  ) {
    this.backend = new BackendClient();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'chat':
          await this.handleChat(msg.text);
          break;
        case 'getStatus':
          this.sendStatus();
          break;
        case 'getHistory':
          this.sendHistory();
          break;
      }
    });

    // Send initial status
    this.sendStatus();
  }

  /** Called externally when git state changes to update the panel */
  notifyContextChanged(commitSha: string, branch: string, restored: boolean): void {
    this.webviewView?.webview.postMessage({
      type: 'contextChanged',
      commitSha,
      branch,
      restored,
    });
    this.sendStatus();
  }

  /** Called externally when a snapshot is saved */
  notifySnapshotSaved(commitSha: string, commitMessage: string): void {
    this.webviewView?.webview.postMessage({
      type: 'snapshotSaved',
      commitSha,
      commitMessage,
    });
  }

  private async handleChat(text: string): Promise<void> {
    this.contextManager.addMessage('user', text);

    // Show user message immediately
    this.webviewView?.webview.postMessage({
      type: 'message',
      role: 'user',
      content: text,
    });

    // Build system prompt
    let systemPrompt = 'You are RewindAI, an AI coding assistant with version-controlled memory tied to git commits. Help the developer understand and work with their codebase.';
    const restoredContext = this.contextManager.getCurrentContextSummary();
    if (restoredContext) {
      systemPrompt += '\n\n--- RESTORED CONTEXT ---\n' + restoredContext + '\n--- END RESTORED CONTEXT ---';
    }

    const messages = this.contextManager.getMessages();

    // Show typing indicator
    this.webviewView?.webview.postMessage({ type: 'typing', show: true });

    try {
      const result = await this.backend.chat(text, systemPrompt, messages);
      this.contextManager.addMessage('assistant', result.response);
      this.webviewView?.webview.postMessage({
        type: 'message',
        role: 'assistant',
        content: result.response,
      });
    } catch {
      const errorMsg = 'Backend not available. Start it with: `cd backend && python3 -m uvicorn app.main:app --reload`';
      this.contextManager.addMessage('assistant', '[backend unavailable]');
      this.webviewView?.webview.postMessage({
        type: 'message',
        role: 'assistant',
        content: errorMsg,
        isError: true,
      });
    }

    this.webviewView?.webview.postMessage({ type: 'typing', show: false });
  }

  private sendStatus(): void {
    const messages = this.contextManager.getMessages();
    const summary = this.contextManager.getCurrentContextSummary();
    const snapshots = this.contextManager.listSnapshots();

    this.webviewView?.webview.postMessage({
      type: 'status',
      messageCount: messages.length,
      hasRestoredContext: !!summary,
      snapshotCount: snapshots.length,
      tokenEstimate: Math.ceil(messages.map(m => m.content).join('').length / 4),
    });
  }

  private sendHistory(): void {
    const snapshots = this.contextManager.listSnapshots();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');

    const items = snapshots.slice(0, 20).map((sha: string) => {
      try {
        const filePath = path.join(this.workspaceRoot, '.rewind', 'snapshots', `${sha}.json`);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const snap = JSON.parse(raw);
        return {
          sha,
          commitMessage: snap.commitMessage || 'No message',
          messageCount: snap.context?.messages?.length || 0,
          decisionCount: snap.context?.decisions?.length || 0,
          timestamp: snap.timestamp || '',
        };
      } catch {
        return { sha, commitMessage: 'Unknown', messageCount: 0, decisionCount: 0, timestamp: '' };
      }
    });

    this.webviewView?.webview.postMessage({ type: 'history', items });
  }

  private getHtml(): string {
    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-panel-background, var(--vscode-editor-background));
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  /* Status bar */
  .status-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    background: var(--vscode-titleBar-activeBackground, var(--vscode-sideBar-background));
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
    font-size: 11px;
    flex-shrink: 0;
  }
  .status-bar .label { opacity: 0.7; }
  .status-bar .value { font-weight: bold; }
  .status-bar .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--vscode-charts-green, #4ec9b0);
    display: inline-block;
  }
  .status-bar .dot.inactive { background: var(--vscode-charts-yellow, #dcdcaa); }

  /* Tab bar */
  .tab-bar {
    display: flex;
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
    flex-shrink: 0;
  }
  .tab {
    padding: 6px 16px;
    cursor: pointer;
    font-size: 12px;
    opacity: 0.7;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--vscode-foreground);
    border-top: none; border-left: none; border-right: none;
  }
  .tab.active {
    opacity: 1;
    border-bottom-color: var(--vscode-focusBorder, #007acc);
  }
  .tab:hover { opacity: 1; }

  /* Panels */
  .panel { flex: 1; overflow: hidden; display: none; flex-direction: column; }
  .panel.active { display: flex; }

  /* Chat */
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }
  .msg {
    margin-bottom: 12px;
    padding: 8px 12px;
    border-radius: 6px;
    max-width: 90%;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .msg.user {
    background: var(--vscode-input-background);
    margin-left: auto;
    border: 1px solid var(--vscode-input-border, transparent);
  }
  .msg.assistant {
    background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04));
    border-left: 3px solid var(--vscode-focusBorder, #007acc);
  }
  .msg.error {
    border-left-color: var(--vscode-errorForeground, #f44);
    opacity: 0.8;
  }
  .msg .role {
    font-size: 10px;
    opacity: 0.6;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .typing {
    padding: 8px 12px;
    font-style: italic;
    opacity: 0.5;
    display: none;
  }
  .typing.show { display: block; }

  /* Input */
  .input-area {
    display: flex;
    padding: 8px 12px;
    gap: 8px;
    border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
    flex-shrink: 0;
  }
  .input-area textarea {
    flex: 1;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    padding: 6px 10px;
    font-family: inherit;
    font-size: inherit;
    resize: none;
    min-height: 32px;
    max-height: 120px;
    outline: none;
  }
  .input-area textarea:focus {
    border-color: var(--vscode-focusBorder, #007acc);
  }
  .input-area button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    cursor: pointer;
    font-size: 12px;
    align-self: flex-end;
  }
  .input-area button:hover {
    background: var(--vscode-button-hoverBackground);
  }

  /* History */
  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }
  .history-item {
    padding: 8px 12px;
    margin-bottom: 6px;
    border-radius: 4px;
    background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04));
    border-left: 3px solid var(--vscode-focusBorder, #007acc);
  }
  .history-item .sha {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    color: var(--vscode-textLink-foreground, #3794ff);
  }
  .history-item .commit-msg {
    margin-top: 2px;
    font-size: 12px;
  }
  .history-item .meta {
    margin-top: 4px;
    font-size: 10px;
    opacity: 0.6;
  }
  .empty-state {
    padding: 24px;
    text-align: center;
    opacity: 0.6;
    font-size: 13px;
  }

  /* Notification toast */
  .toast {
    position: fixed;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--vscode-notificationsInfoIcon-foreground, #3794ff);
    color: white;
    padding: 6px 16px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 100;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
  }
  .toast.show { opacity: 1; }
</style>
</head>
<body>

<div class="status-bar">
  <span class="dot" id="statusDot"></span>
  <span><span class="label">Messages:</span> <span class="value" id="msgCount">0</span></span>
  <span><span class="label">Snapshots:</span> <span class="value" id="snapCount">0</span></span>
  <span><span class="label">Context:</span> <span class="value" id="contextStatus">Fresh</span></span>
</div>

<div class="tab-bar">
  <button class="tab active" data-panel="chat">Chat</button>
  <button class="tab" data-panel="history">History</button>
</div>

<div class="panel active" id="panel-chat">
  <div class="messages" id="messages">
    <div class="msg assistant">
      <div class="role">RewindAI</div>
      Welcome! I'm RewindAI — your AI coding assistant with version-controlled memory.

Chat with me about your code. When you commit, our conversation context is automatically saved. When you checkout a different commit, I'll remember what we discussed at that point.

Ask me anything about your codebase!</div>
  </div>
  <div class="typing" id="typing">RewindAI is thinking...</div>
  <div class="input-area">
    <textarea id="input" rows="1" placeholder="Ask RewindAI about your code..."></textarea>
    <button id="sendBtn">Send</button>
  </div>
</div>

<div class="panel" id="panel-history">
  <div class="history-list" id="historyList">
    <div class="empty-state">No snapshots yet. Chat and commit to save context.</div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('sendBtn');
  const typingEl = document.getElementById('typing');
  const historyList = document.getElementById('historyList');
  const toast = document.getElementById('toast');

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
      if (tab.dataset.panel === 'history') {
        vscode.postMessage({ type: 'getHistory' });
      }
    });
  });

  // Send message
  function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.style.height = '32px';
    vscode.postMessage({ type: 'chat', text });
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // Auto-resize textarea
  inputEl.addEventListener('input', () => {
    inputEl.style.height = '32px';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // Show toast notification
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // Handle messages from extension
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'message': {
        const div = document.createElement('div');
        div.className = 'msg ' + msg.role + (msg.isError ? ' error' : '');
        div.innerHTML = '<div class="role">' + (msg.role === 'user' ? 'You' : 'RewindAI') + '</div>' +
          escapeHtml(msg.content);
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        break;
      }
      case 'typing':
        typingEl.classList.toggle('show', msg.show);
        break;
      case 'status':
        document.getElementById('msgCount').textContent = msg.messageCount;
        document.getElementById('snapCount').textContent = msg.snapshotCount;
        document.getElementById('contextStatus').textContent =
          msg.hasRestoredContext ? 'Restored' : 'Fresh';
        document.getElementById('statusDot').className =
          'dot' + (msg.hasRestoredContext ? '' : ' inactive');
        break;
      case 'history': {
        if (msg.items.length === 0) {
          historyList.innerHTML = '<div class="empty-state">No snapshots yet. Chat and commit to save context.</div>';
        } else {
          historyList.innerHTML = '';
          msg.items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML =
              '<span class="sha">' + item.sha.slice(0, 7) + '</span>' +
              '<div class="commit-msg">' + escapeHtml(item.commitMessage.slice(0, 80)) + '</div>' +
              '<div class="meta">' + item.messageCount + ' messages, ' +
              item.decisionCount + ' decisions' +
              (item.timestamp ? ' — ' + new Date(item.timestamp).toLocaleString() : '') +
              '</div>';
            historyList.appendChild(div);
          });
        }
        break;
      }
      case 'snapshotSaved':
        showToast('Context saved for ' + msg.commitSha.slice(0, 7) + ': ' + msg.commitMessage.slice(0, 40));
        break;
      case 'contextChanged':
        showToast(msg.restored
          ? 'Context restored to ' + msg.commitSha.slice(0, 7) + ' (' + msg.branch + ')'
          : 'No saved context for ' + msg.commitSha.slice(0, 7) + ' — fresh session');
        break;
    }
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Request initial status
  vscode.postMessage({ type: 'getStatus' });
</script>
</body>
</html>`;
  }
}
