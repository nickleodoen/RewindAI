import * as vscode from 'vscode';
import { ContextManager } from '../context/manager';
import { ToolExecutor } from '../tools/executor';
import { AgentLoop } from '../agent/loop';

/**
 * Provides the RewindAI webview panel that appears as its own tab
 * in the bottom panel area (next to Terminal, Claude Code, etc.).
 * Now connects to the AgentLoop for full agentic coding assistance.
 */
export class RewindPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'rewindai.panel';
  private webviewView: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly contextManager: ContextManager,
    private readonly workspaceRoot: string,
  ) {}

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

    this.sendStatus();
  }

  notifyContextChanged(commitSha: string, branch: string, restored: boolean): void {
    this.webviewView?.webview.postMessage({
      type: 'contextChanged',
      commitSha,
      branch,
      restored,
    });
    this.sendStatus();
  }

  notifySnapshotSaved(commitSha: string, commitMessage: string): void {
    this.webviewView?.webview.postMessage({
      type: 'snapshotSaved',
      commitSha,
      commitMessage,
    });
  }

  private async handleChat(text: string): Promise<void> {
    // Handle /whatchanged command locally
    if (text.trim().startsWith('/whatchanged')) {
      await this.handleWhatChanged();
      return;
    }

    // Show user message immediately
    this.webviewView?.webview.postMessage({ type: 'message', role: 'user', content: text });
    this.webviewView?.webview.postMessage({ type: 'typing', show: true });

    // Get LLM config from VS Code settings
    const config = vscode.workspace.getConfiguration('rewindai');
    const provider = (config.get<string>('provider') || 'anthropic') as 'anthropic' | 'openai';
    const apiKey = config.get<string>('apiKey') || process.env.ANTHROPIC_API_KEY || '';
    const model = config.get<string>('model') || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o');

    if (!apiKey) {
      this.webviewView?.webview.postMessage({ type: 'typing', show: false });
      this.webviewView?.webview.postMessage({
        type: 'message',
        role: 'assistant',
        content: 'No API key configured.\n\nOpen VS Code Settings (Cmd+,) and search for "rewindai":\n• rewindai.apiKey — your Anthropic or OpenAI API key\n• rewindai.provider — "anthropic" or "openai"\n• rewindai.model — e.g. "claude-sonnet-4-6" or "gpt-4o"',
        isError: true,
      });
      return;
    }

    // Create agent components
    const toolExecutor = new ToolExecutor(this.workspaceRoot, this.contextManager);
    const agentLoop = new AgentLoop(
      { provider, apiKey, model },
      toolExecutor,
      this.contextManager,
    );

    // Run the agent — it streams events back
    try {
      await agentLoop.run(text, (event) => {
        switch (event.type) {
          case 'text':
            this.webviewView?.webview.postMessage({
              type: 'message', role: 'assistant', content: event.content,
            });
            break;
          case 'tool_call':
            this.webviewView?.webview.postMessage({
              type: 'tool', action: 'call', toolName: event.toolName, content: event.content,
            });
            break;
          case 'tool_result':
            this.webviewView?.webview.postMessage({
              type: 'tool', action: 'result', toolName: event.toolName, content: event.content, isError: event.isError,
            });
            break;
          case 'error':
            this.webviewView?.webview.postMessage({
              type: 'message', role: 'assistant', content: event.content, isError: true,
            });
            break;
          case 'thinking':
          case 'done':
            break;
        }
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.webviewView?.webview.postMessage({
        type: 'message', role: 'assistant', content: `Agent error: ${msg}`, isError: true,
      });
    }

    this.webviewView?.webview.postMessage({ type: 'typing', show: false });
    this.sendStatus();
  }

  private async handleWhatChanged(): Promise<void> {
    this.webviewView?.webview.postMessage({ type: 'message', role: 'user', content: '/whatchanged' });
    this.webviewView?.webview.postMessage({ type: 'typing', show: true });

    const scratchpad = this.contextManager.getScratchpad();
    const messages = this.contextManager.getMessages();
    const summary = this.contextManager.getCurrentContextSummary();

    let response = '';

    if (scratchpad.length > 0) {
      response += 'Session notes:\n';
      for (const note of scratchpad) { response += `  ${note}\n`; }
      response += '\n';
    }

    if (messages.length > 0) {
      const userMsgs = messages.filter(m => m.role === 'user');
      response += `Conversation: ${messages.length} messages (${userMsgs.length} from you)\n`;
    }

    if (summary) { response += '\n' + summary; }

    if (!response) {
      response = 'No changes tracked yet. Start chatting and I\'ll track decisions and context automatically.';
    }

    this.webviewView?.webview.postMessage({ type: 'message', role: 'assistant', content: response });
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
    overflow: hidden;
  }

  /* Branded header */
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--vscode-titleBar-activeBackground, var(--vscode-sideBar-background));
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }
  .header .brand { color: var(--vscode-textLink-foreground, #3794ff); }
  .header .version { opacity: 0.4; font-weight: normal; font-size: 10px; }

  /* Status bar */
  .status-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 10px;
    background: var(--vscode-titleBar-activeBackground, var(--vscode-sideBar-background));
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
    font-size: 10px;
    flex-shrink: 0;
    flex-wrap: wrap;
    min-height: 20px;
  }
  .status-bar .stat { display: flex; align-items: center; gap: 3px; white-space: nowrap; }
  .status-bar .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-charts-green, #4ec9b0); display: inline-block; flex-shrink: 0; }
  .status-bar .dot.inactive { background: var(--vscode-charts-yellow, #dcdcaa); }
  .status-bar .val { font-weight: bold; }
  .status-bar .lbl { opacity: 0.5; }

  /* Tab bar */
  .tab-bar {
    display: flex;
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
    flex-shrink: 0;
  }
  .tab {
    padding: 5px 12px; cursor: pointer; font-size: 11px; opacity: 0.7;
    border-bottom: 2px solid transparent; background: none;
    color: var(--vscode-foreground); border-top: none; border-left: none; border-right: none;
  }
  .tab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder, #007acc); }
  .tab:hover { opacity: 1; }

  /* Panels */
  .panel { flex: 1; overflow: hidden; display: none; flex-direction: column; min-height: 0; }
  .panel.active { display: flex; }

  /* Messages */
  .messages { flex: 1; overflow-y: auto; padding: 8px; min-height: 0; }
  .msg {
    margin-bottom: 8px; padding: 6px 8px; border-radius: 4px;
    max-width: 95%; line-height: 1.4; white-space: pre-wrap;
    word-wrap: break-word; overflow-wrap: anywhere; font-size: 12px;
  }
  .msg.user {
    background: var(--vscode-input-background); margin-left: auto;
    border: 1px solid var(--vscode-input-border, transparent);
  }
  .msg.assistant {
    background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04));
    border-left: 2px solid var(--vscode-focusBorder, #007acc);
  }
  .msg.error { border-left-color: var(--vscode-errorForeground, #f44); opacity: 0.8; }
  .msg .role { font-size: 9px; opacity: 0.5; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px; }

  /* Tool calls and results */
  .tool-block {
    margin: 4px 0; padding: 6px 10px; border-radius: 4px;
    font-size: 11px; font-family: var(--vscode-editor-font-family, monospace);
    line-height: 1.4; overflow-x: auto; word-break: break-all;
  }
  .tool-block.call {
    background: rgba(55, 148, 255, 0.1);
    border-left: 3px solid var(--vscode-textLink-foreground, #3794ff);
  }
  .tool-block.call .tool-label {
    color: var(--vscode-textLink-foreground, #3794ff);
    font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px;
  }
  .tool-block.result {
    background: rgba(78, 201, 176, 0.06);
    border-left: 3px solid var(--vscode-charts-green, #4ec9b0);
    white-space: pre-wrap; max-height: 200px; overflow-y: auto;
  }
  .tool-block.result.error {
    background: rgba(244, 68, 68, 0.06);
    border-left-color: var(--vscode-errorForeground, #f44);
  }

  .typing { padding: 6px 8px; font-style: italic; opacity: 0.5; font-size: 11px; display: none; }
  .typing.show { display: block; }

  /* Input */
  .input-area {
    display: flex; padding: 6px 8px; gap: 6px;
    border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border)); flex-shrink: 0;
  }
  .input-area textarea {
    flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
    padding: 5px 8px; font-family: inherit; font-size: 12px; resize: none;
    min-height: 28px; max-height: 100px; outline: none; min-width: 0;
  }
  .input-area textarea:focus { border-color: var(--vscode-focusBorder, #007acc); }
  .input-area button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer;
    font-size: 11px; align-self: flex-end; white-space: nowrap; flex-shrink: 0;
  }
  .input-area button:hover { background: var(--vscode-button-hoverBackground); }

  /* History */
  .history-list { flex: 1; overflow-y: auto; padding: 8px; min-height: 0; }
  .history-item {
    padding: 6px 8px; margin-bottom: 4px; border-radius: 4px;
    background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04));
    border-left: 2px solid var(--vscode-focusBorder, #007acc);
  }
  .history-item .sha { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; color: var(--vscode-textLink-foreground, #3794ff); }
  .history-item .commit-msg { margin-top: 2px; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .history-item .meta { margin-top: 2px; font-size: 9px; opacity: 0.5; }
  .empty-state { padding: 16px; text-align: center; opacity: 0.5; font-size: 12px; }

  /* Toast */
  .toast {
    position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
    background: var(--vscode-notificationsInfoIcon-foreground, #3794ff); color: white;
    padding: 4px 12px; border-radius: 4px; font-size: 11px; z-index: 100;
    opacity: 0; transition: opacity 0.3s; pointer-events: none;
    max-width: 90%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .toast.show { opacity: 1; }
</style>
</head>
<body>

<div class="header">
  <span class="brand">RewindAI</span>
  <span class="version">v0.3 — Agent</span>
</div>

<div class="status-bar">
  <span class="stat"><span class="dot" id="statusDot"></span></span>
  <span class="stat"><span class="lbl">Msgs</span> <span class="val" id="msgCount">0</span></span>
  <span class="stat"><span class="lbl">Snaps</span> <span class="val" id="snapCount">0</span></span>
  <span class="stat"><span class="val" id="contextStatus">Fresh</span></span>
</div>

<div class="tab-bar">
  <button class="tab active" data-panel="chat">Chat</button>
  <button class="tab" data-panel="history">History</button>
</div>

<div class="panel active" id="panel-chat">
  <div class="messages" id="messages">
    <div class="msg assistant">
      <div class="role">RewindAI</div>
<strong>AI coding assistant with version-controlled memory.</strong>

I can read, edit, and create files, run terminal commands, and search your codebase.

When you commit, I save our context. When you checkout a different commit, I remember what we discussed there.

<em style="opacity:0.6">Configure your API key: Settings (Cmd+,) > search "rewindai"</em></div>
  </div>
  <div class="typing" id="typing">Thinking...</div>
  <div class="input-area">
    <textarea id="input" rows="1" placeholder="Ask RewindAI to code..."></textarea>
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

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
      if (tab.dataset.panel === 'history') { vscode.postMessage({ type: 'getHistory' }); }
    });
  });

  function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.style.height = '28px';
    vscode.postMessage({ type: 'chat', text });
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = '28px';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

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
      case 'tool': {
        const div = document.createElement('div');
        if (msg.action === 'call') {
          div.className = 'tool-block call';
          div.innerHTML = '<div class="tool-label">' + escapeHtml(msg.toolName || '') + '</div>' + escapeHtml(msg.content);
        } else {
          div.className = 'tool-block result' + (msg.isError ? ' error' : '');
          div.textContent = msg.content;
        }
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
        document.getElementById('contextStatus').textContent = msg.hasRestoredContext ? 'Restored' : 'Fresh';
        document.getElementById('statusDot').className = 'dot' + (msg.hasRestoredContext ? '' : ' inactive');
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
              '<div class="commit-msg">' + escapeHtml(item.commitMessage.slice(0, 60)) + '</div>' +
              '<div class="meta">' + item.messageCount + ' msgs, ' +
              item.decisionCount + ' decisions' +
              (item.timestamp ? ' — ' + new Date(item.timestamp).toLocaleDateString() : '') +
              '</div>';
            historyList.appendChild(div);
          });
        }
        break;
      }
      case 'snapshotSaved':
        showToast('Saved ' + msg.commitSha.slice(0, 7));
        break;
      case 'contextChanged':
        showToast(msg.restored ? 'Restored ' + msg.commitSha.slice(0, 7) : 'Fresh session');
        break;
    }
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  vscode.postMessage({ type: 'getStatus' });
</script>
</body>
</html>`;
  }
}
