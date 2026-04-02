import * as vscode from 'vscode';
import { ContextManager } from '../context/manager';
import { ToolExecutor } from '../tools/executor';
import { AgentLoop } from '../agent/loop';
import { SessionNoteGenerator } from '../context/sessionNotes';
import { CommitSuggester } from '../context/commitSuggester';
import { Neo4jGraphClient } from '../graph/neo4jClient';
import { RocketRideClient } from '../pipelines/rocketrideClient';

/**
 * Provides the RewindAI webview panel that appears as its own tab
 * in the bottom panel area (next to Terminal, Claude Code, etc.).
 * Includes built-in setup UI for API key configuration.
 */
export class RewindPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'rewindai.panel';
  private webviewView: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly contextManager: ContextManager,
    private readonly workspaceRoot: string,
    private readonly neo4j?: Neo4jGraphClient,
    private readonly rocketride?: RocketRideClient,
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
        case 'getConfig':
          this.sendConfig();
          break;
        case 'saveConfig':
          await this.saveConfig(msg.provider, msg.apiKey, msg.model);
          break;
      }
    });

    this.sendStatus();
    // Send config so the UI knows whether to show setup screen
    setTimeout(() => this.sendConfig(), 100);
  }

  notifyContextChanged(commitSha: string, branch: string, restored: boolean): void {
    // Clear the chat messages in the UI
    this.webviewView?.webview.postMessage({ type: 'clearChat' });

    // Show a context change message
    this.webviewView?.webview.postMessage({
      type: 'message',
      role: 'assistant',
      content: restored
        ? `Context restored to commit ${commitSha.slice(0, 7)} (${branch})\n\nI remember what we discussed at this point. Ask me anything — my memory matches this commit's state.`
        : `Switched to commit ${commitSha.slice(0, 7)} (${branch})\n\nNo saved context for this commit — starting a fresh session. Our conversation will be saved when you commit.`,
    });

    this.webviewView?.webview.postMessage({ type: 'contextChanged', commitSha, branch, restored });
    this.sendStatus();
  }

  notifySnapshotSaved(commitSha: string, commitMessage: string): void {
    this.webviewView?.webview.postMessage({ type: 'snapshotSaved', commitSha, commitMessage });
  }

  private async saveConfig(provider: string, apiKey: string, model: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('rewindai');
    await config.update('provider', provider, vscode.ConfigurationTarget.Global);
    await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
    if (model) {
      await config.update('model', model, vscode.ConfigurationTarget.Global);
    }
    this.webviewView?.webview.postMessage({ type: 'configSaved', success: true });
    this.sendConfig();
    vscode.window.showInformationMessage('RewindAI: API key saved. You\'re ready to go!');
  }

  private sendConfig(): void {
    const config = vscode.workspace.getConfiguration('rewindai');
    const provider = config.get<string>('provider') || 'anthropic';
    const apiKey = config.get<string>('apiKey') || '';
    const model = config.get<string>('model') || '';
    this.webviewView?.webview.postMessage({
      type: 'config',
      provider,
      hasApiKey: !!apiKey,
      apiKeyPreview: apiKey ? apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 4) : '',
      model,
    });
  }

  private async handleChat(text: string): Promise<void> {
    // ── Production commands (visible to users) ──
    if (text.trim().startsWith('/rewind ')) {
      await this.handleRewind(text.replace('/rewind ', '').trim());
      return;
    }
    if (text.trim() === '/context') { await this.handleContext(); return; }
    if (text.trim() === '/export') { await this.handleExport(); return; }
    if (text.trim() === '/forget') { await this.handleForget(); return; }

    // ── Internal/debug commands (still work, but hidden from UI) ──
    if (text.trim().startsWith('/whatchanged')) { await this.handleWhatChanged(); return; }
    if (text.trim() === '/sessions' || text.trim() === '/notes') { await this.handleSessions(); return; }
    if (text.trim() === '/graph') { await this.handleGraph(); return; }
    if (text.trim().startsWith('/why')) {
      const fileArg = text.trim().replace(/^\/why\s*/, '').trim();
      await this.handleWhy(fileArg);
      return;
    }
    if (text.trim().startsWith('/suggest ')) {
      await this.handleRewind(text.replace('/suggest ', '').trim());
      return;
    }
    if (text.trim() === '/status') { await this.handleContext(); return; }

    this.webviewView?.webview.postMessage({ type: 'message', role: 'user', content: text });
    this.webviewView?.webview.postMessage({ type: 'typing', show: true });

    const config = vscode.workspace.getConfiguration('rewindai');
    const provider = (config.get<string>('provider') || 'anthropic') as 'anthropic' | 'openai';
    const apiKey = config.get<string>('apiKey') || process.env.ANTHROPIC_API_KEY || '';
    const model = config.get<string>('model') || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o');

    if (!apiKey) {
      this.webviewView?.webview.postMessage({ type: 'typing', show: false });
      // Show setup screen
      this.webviewView?.webview.postMessage({ type: 'showSetup' });
      return;
    }

    const toolExecutor = new ToolExecutor(this.workspaceRoot, this.contextManager);
    const agentLoop = new AgentLoop(
      { provider, apiKey, model },
      toolExecutor,
      this.contextManager,
      this.workspaceRoot,
      this.rocketride,
    );

    try {
      await agentLoop.run(text, (event) => {
        switch (event.type) {
          case 'text':
            this.webviewView?.webview.postMessage({ type: 'message', role: 'assistant', content: event.content });
            break;
          case 'tool_call':
            this.webviewView?.webview.postMessage({ type: 'tool', action: 'call', toolName: event.toolName, content: event.content });
            break;
          case 'tool_result':
            this.webviewView?.webview.postMessage({ type: 'tool', action: 'result', toolName: event.toolName, content: event.content, isError: event.isError });
            break;
          case 'error':
            this.webviewView?.webview.postMessage({ type: 'message', role: 'assistant', content: event.content, isError: true });
            break;
          case 'thinking':
          case 'done':
            break;
        }
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.webviewView?.webview.postMessage({ type: 'message', role: 'assistant', content: `Agent error: ${msg}`, isError: true });
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
    if (!response) { response = 'No changes tracked yet. Start chatting and I\'ll track decisions and context automatically.'; }

    this.webviewView?.webview.postMessage({ type: 'message', role: 'assistant', content: response });
    this.webviewView?.webview.postMessage({ type: 'typing', show: false });
  }

  private async handleSessions(): Promise<void> {
    this.webviewView?.webview.postMessage({ type: 'message', role: 'user', content: '/sessions' });

    const noteGen = new SessionNoteGenerator(this.workspaceRoot);
    const sessions = noteGen.listSessionFiles();
    const compacted = noteGen.listCompactedFiles();

    if (sessions.length === 0 && compacted.length === 0) {
      this.webviewView?.webview.postMessage({
        type: 'message', role: 'assistant',
        content: 'No session notes yet. Chat with me and I\'ll save detailed notes about each conversation.\n\nSession notes include: file changes with diffs, decisions made, commands run, key insights, and open questions.',
      });
      return;
    }

    let output = `Session Notes (${sessions.length} sessions, ${compacted.length} compacted)\n\n`;

    if (compacted.length > 0) {
      output += `Latest compacted summary: ${compacted[0]}\n\n`;
    }

    output += 'Recent sessions:\n';
    for (const filename of sessions.slice(0, 10)) {
      const content = noteGen.readSessionFile(filename);
      const title = content.split('\n')[0]?.replace('# Session: ', '') || filename;
      output += `  ${filename.slice(0, 19)} — ${title}\n`;
    }

    output += '\nSession notes are saved to .rewind/sessions/ and auto-compacted every 5 sessions.';
    output += '\nThey are automatically loaded as context when you return to a commit.';

    this.webviewView?.webview.postMessage({ type: 'message', role: 'assistant', content: output });
  }

  private async handleCommitSuggestion(query: string): Promise<void> {
    this.webviewView?.webview.postMessage({ type: 'message', role: 'user', content: query });
    this.webviewView?.webview.postMessage({ type: 'typing', show: true });

    const suggester = new CommitSuggester(this.workspaceRoot, this.neo4j);
    const suggestions = await suggester.suggest(query);

    this.webviewView?.webview.postMessage({ type: 'typing', show: false });

    if (suggestions.length === 0) {
      this.webviewView?.webview.postMessage({
        type: 'message', role: 'assistant',
        content: 'No matching commits found.\n\nI searched through all commits and their saved context but couldn\'t find a good match. Try being more specific — mention file names, features, or decisions.',
      });
      return;
    }

    let response = 'Suggested commits to checkout:\n\n';

    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      const rank = i === 0 ? '1.' : i === 1 ? '2.' : '3.';
      response += `${rank} ${s.sha.slice(0, 7)} — ${s.message}\n`;
      response += `   Score: ${s.score.toFixed(1)} | Branch: ${s.branch}\n`;

      if (s.matchReasons.length > 0) {
        response += '   Matched because:\n';
        for (const reason of s.matchReasons.slice(0, 3)) {
          response += `   - ${reason}\n`;
        }
      }

      if (s.decisions && s.decisions.length > 0) {
        response += '   Decisions at this commit:\n';
        for (const d of s.decisions.slice(0, 2)) {
          response += `   - ${d.slice(0, 80)}\n`;
        }
      }

      response += '\n';
    }

    response += `To checkout, run in terminal: git checkout ${suggestions[0].sha.slice(0, 7)}\n`;
    response += 'RewindAI will automatically restore the context for that commit.';

    this.webviewView?.webview.postMessage({ type: 'message', role: 'assistant', content: response });
  }

  /**
   * /graph — Show Neo4j graph stats and connection status.
   */
  private async handleGraph(): Promise<void> {
    this.webviewView?.webview.postMessage({ type: 'message', role: 'user', content: '/graph' });
    this.webviewView?.webview.postMessage({ type: 'typing', show: true });

    let output = '**Graph Database Status**\n\n';

    if (!this.neo4j?.isConnected()) {
      output += 'Neo4j: **Not connected**\n\n';
      output += 'Start Neo4j with: `docker compose up -d neo4j`\n';
      output += 'Or configure the URI in settings: `rewindai.neo4jUri`';
    } else {
      try {
        const stats = await this.neo4j.getStats();
        output += `Neo4j: **Connected**\n\n`;
        output += `- Commits indexed: **${stats.commits}**\n`;
        output += `- Sessions indexed: **${stats.sessions}**\n`;
        output += `- Decisions tracked: **${stats.decisions}**\n`;
        output += `- Files tracked: **${stats.files}**\n`;
      } catch {
        output += 'Neo4j: **Connected** but query failed\n';
      }
    }

    output += '\n\n';
    output += `RocketRide: **${this.rocketride?.isConnected() ? 'Connected' : 'Not connected'}**\n`;
    if (!this.rocketride?.isConnected()) {
      output += 'Start RocketRide with: `docker compose up -d rocketride`';
    }

    this.webviewView?.webview.postMessage({ type: 'typing', show: false });
    this.webviewView?.webview.postMessage({ type: 'message', role: 'assistant', content: output });
  }

  /**
   * /why <file> — Show the decision chain and commit history for a file using Neo4j.
   */
  private async handleWhy(fileArg: string): Promise<void> {
    this.webviewView?.webview.postMessage({ type: 'message', role: 'user', content: `/why ${fileArg}` });
    this.webviewView?.webview.postMessage({ type: 'typing', show: true });

    if (!fileArg) {
      this.webviewView?.webview.postMessage({ type: 'typing', show: false });
      this.webviewView?.webview.postMessage({
        type: 'message', role: 'assistant',
        content: 'Usage: `/why <file>` — Shows why a file exists and the decisions that shaped it.\n\nExample: `/why src/auth/middleware.ts`',
      });
      return;
    }

    let output = `**Why does \`${fileArg}\` exist?**\n\n`;

    if (!this.neo4j?.isConnected()) {
      // Fallback: search snapshots on disk
      output += '_Neo4j not connected — using file-based search_\n\n';
      const suggester = new CommitSuggester(this.workspaceRoot);
      const results = await suggester.suggest(fileArg);
      if (results.length > 0) {
        output += 'Commits that mention this file:\n\n';
        for (const r of results.slice(0, 5)) {
          output += `- **${r.sha.slice(0, 7)}** — ${r.message}\n`;
          if (r.decisions && r.decisions.length > 0) {
            for (const d of r.decisions.slice(0, 2)) {
              output += `  - Decision: ${d.slice(0, 80)}\n`;
            }
          }
        }
      } else {
        output += 'No matching context found for this file.';
      }
    } else {
      try {
        // Get commits that touched this file
        const commits = await this.neo4j.findCommitsForFile(fileArg);
        if (commits.length > 0) {
          output += `**Commits that discussed this file (${commits.length}):**\n\n`;
          for (const c of commits.slice(0, 8)) {
            output += `- **${c.sha.slice(0, 7)}** — ${c.message}\n`;
            if (c.decisions && c.decisions.length > 0) {
              for (const d of c.decisions.slice(0, 2)) {
                output += `  - Decision: ${d.slice(0, 80)}\n`;
              }
            }
          }
          output += '\n';

          // Trace decision chains for the first decision found
          const firstDecision = commits.flatMap(c => c.decisions || []).find(d => d);
          if (firstDecision) {
            const chain = await this.neo4j.getDecisionChain(firstDecision.slice(0, 50));
            if (chain.length > 1) {
              output += `**Decision chain:**\n\n`;
              for (const d of chain) {
                const indent = '  '.repeat(d.depth);
                output += `${indent}- ${d.content}\n`;
                if (d.commitSha) {
                  output += `${indent}  _(at ${d.commitSha.slice(0, 7)})_\n`;
                }
              }
            }
          }
        } else {
          output += 'No graph data found for this file. It may not have been discussed in any tracked sessions.';
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        output += `Graph query failed: ${msg}`;
      }
    }

    this.webviewView?.webview.postMessage({ type: 'typing', show: false });
    this.webviewView?.webview.postMessage({ type: 'message', role: 'assistant', content: output });
  }

  // ══════════════════════════════════════════════════════
  // Production commands: /rewind, /context, /export, /forget
  // ══════════════════════════════════════════════════════

  private async handleRewind(query: string): Promise<void> {
    this.webviewView?.webview.postMessage({ type: 'message', role: 'user', content: `/rewind ${query}` });
    this.webviewView?.webview.postMessage({ type: 'typing', show: true });

    const suggester = new CommitSuggester(this.workspaceRoot, this.neo4j);
    const suggestions = await suggester.suggest(query);

    this.webviewView?.webview.postMessage({ type: 'typing', show: false });

    if (suggestions.length === 0) {
      this.webviewView?.webview.postMessage({
        type: 'message', role: 'assistant',
        content: `Couldn't find a commit matching "${query}". Try describing the feature or decision you want to go back to.`,
      });
      return;
    }

    const top = suggestions[0];
    const contextFilePath = await this.generateMegaContext(top.sha, top.message);

    let response = `**Found ${suggestions.length} matching commit${suggestions.length > 1 ? 's' : ''}:**\n\n`;

    for (let i = 0; i < Math.min(suggestions.length, 3); i++) {
      const s = suggestions[i];
      const marker = i === 0 ? '\u2192' : ' ';
      response += `${marker} \`${s.sha.slice(0, 7)}\` \u2014 ${s.message}\n`;
      if (s.decisions && s.decisions.length > 0) {
        response += `  Decisions: ${s.decisions.slice(0, 2).join('; ')}\n`;
      }
    }

    response += `\n**To rewind:**\n`;
    response += `\`\`\`\ngit checkout ${top.sha.slice(0, 7)}\n\`\`\`\n`;
    response += `Your AI context will auto-restore when you checkout.\n\n`;

    if (contextFilePath) {
      response += `**Or use the context anywhere:**\n`;
      response += `Context file saved \u2192 \`${contextFilePath}\`\n`;
      response += `Open it and paste into Claude Code, ChatGPT, or any AI chat to continue from that point.`;
    }

    this.webviewView?.webview.postMessage({ type: 'message', role: 'assistant', content: response });
  }

  private async handleContext(): Promise<void> {
    this.webviewView?.webview.postMessage({ type: 'message', role: 'user', content: '/context' });

    const summary = this.contextManager.getCurrentContextSummary();
    const messages = this.contextManager.getMessages();

    if (!summary && messages.length <= 1) {
      this.webviewView?.webview.postMessage({
        type: 'message', role: 'assistant',
        content: `**Fresh session** \u2014 no prior context loaded.\n\nStart chatting and I'll build up context. When you commit, everything gets saved automatically.`,
      });
      return;
    }

    let response = `**Current Context**\n\n`;
    response += `Messages this session: ${messages.length}\n\n`;

    const scratchpad = this.contextManager.getScratchpad();
    const decisions = scratchpad.filter(n => n.includes('DECISION:'));
    const edits = scratchpad.filter(n => n.includes('EDITED:') || n.includes('RAN:'));

    if (decisions.length > 0) {
      response += `**Decisions made:**\n`;
      for (const d of decisions.slice(-5)) {
        response += `\u2022 ${d.replace(/\[.*?\]\s*/, '').replace('DECISION: ', '')}\n`;
      }
      response += '\n';
    }

    if (edits.length > 0) {
      response += `**Recent actions:**\n`;
      for (const e of edits.slice(-5)) {
        response += `\u2022 ${e.replace(/\[.*?\]\s*/, '')}\n`;
      }
      response += '\n';
    }

    if (summary) {
      response += `*Context restored from a previous commit. I remember what we discussed.*`;
    }

    this.webviewView?.webview.postMessage({ type: 'message', role: 'assistant', content: response });
  }

  private async handleExport(): Promise<void> {
    this.webviewView?.webview.postMessage({ type: 'message', role: 'user', content: '/export' });

    const filePath = await this.generateMegaContext('current', 'current session');

    if (filePath) {
      this.webviewView?.webview.postMessage({
        type: 'message', role: 'assistant',
        content: `**Context exported!**\n\n` +
          `File: \`${filePath}\`\n\n` +
          `This file contains your full conversation context, decisions, and file changes. ` +
          `You can:\n` +
          `\u2022 Paste it into a new Claude Code session\n` +
          `\u2022 Upload it to ChatGPT or any AI chat\n` +
          `\u2022 Share it with a teammate\n\n` +
          `The file gives any AI full context about what you've been working on.`,
      });
    } else {
      this.webviewView?.webview.postMessage({
        type: 'message', role: 'assistant',
        content: `Nothing to export yet \u2014 start chatting first!`,
      });
    }
  }

  private async handleForget(): Promise<void> {
    this.contextManager.resetConversation();
    this.webviewView?.webview.postMessage({ type: 'clearChat' });
    this.webviewView?.webview.postMessage({
      type: 'message', role: 'assistant',
      content: `**Session cleared.** Starting fresh.\n\nYour saved snapshots are still intact \u2014 they'll be there when you checkout previous commits. This just clears the current conversation.`,
    });
    this.sendStatus();
  }

  // ══════════════════════════════════════════════════════
  // Mega Context File Generator
  // ══════════════════════════════════════════════════════

  private async generateMegaContext(commitSha: string, commitMessage: string): Promise<string | null> {
    const fs = require('fs');
    const pathMod = require('path');

    const messages = this.contextManager.getMessages();
    const scratchpad = this.contextManager.getScratchpad();

    if (messages.length === 0 && scratchpad.length === 0) { return null; }

    const lines: string[] = [];

    // Header
    lines.push('# RewindAI Context Export');
    lines.push(`> Generated by RewindAI \u2014 paste this into any AI chat to continue working`);
    lines.push(`> Commit: \`${commitSha.slice(0, 7)}\` \u2014 ${commitMessage}`);
    lines.push(`> Exported: ${new Date().toISOString()}`);
    lines.push('');

    // Instructions for the receiving AI
    lines.push('## Instructions for AI');
    lines.push('You are continuing a coding session. The context below contains the full history');
    lines.push('of decisions made, files changed, and conversations had. Use this to:');
    lines.push('1. Understand what has been done so far');
    lines.push('2. Know what decisions were made and why');
    lines.push('3. Continue working from exactly this point');
    lines.push('4. Reference specific files and changes when asked');
    lines.push('');

    // Project info
    lines.push('## Project');
    try {
      const readmePath = pathMod.join(this.workspaceRoot, 'README.md');
      if (fs.existsSync(readmePath)) {
        const readme = fs.readFileSync(readmePath, 'utf-8');
        lines.push(readme.slice(0, 500));
        if (readme.length > 500) { lines.push('... (truncated)'); }
      }
    } catch { /* skip */ }
    lines.push('');

    // File structure
    lines.push('## Current File Structure');
    try {
      const { execSync } = require('child_process');
      const tree = execSync(
        'find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/.rewind/*" -not -path "*/out/*" -not -path "*/__pycache__/*" | head -50',
        { cwd: this.workspaceRoot, timeout: 5000 }
      ).toString();
      lines.push('```');
      lines.push(tree.trim());
      lines.push('```');
    } catch { /* skip */ }
    lines.push('');

    // Decisions
    const decisions = scratchpad.filter(n => n.includes('DECISION'));
    if (decisions.length > 0) {
      lines.push('## Decisions Made');
      for (const d of decisions) {
        lines.push(`- ${d.replace(/\[.*?\]\s*/, '')}`);
      }
      lines.push('');
    }

    // Files changed
    const fileEdits = scratchpad.filter(n => n.includes('EDITED') || n.includes('RAN'));
    if (fileEdits.length > 0) {
      lines.push('## Actions Taken');
      for (const e of fileEdits) {
        lines.push(`- ${e.replace(/\[.*?\]\s*/, '')}`);
      }
      lines.push('');
    }

    // Conversation history (condensed)
    if (messages.length > 0) {
      lines.push('## Conversation History');
      const relevantMessages = messages
        .filter(m => !m.content.startsWith('[Tool:') && !m.content.startsWith('[Result:'))
        .slice(-20);
      for (const m of relevantMessages) {
        const role = m.role === 'user' ? 'USER' : 'AI';
        const content = m.content.slice(0, 500);
        lines.push(`**${role}:** ${content}`);
        if (m.content.length > 500) { lines.push('*(truncated)*'); }
        lines.push('');
      }
    }

    // Session notes (from .rewind/sessions/)
    const noteGen = new SessionNoteGenerator(this.workspaceRoot);
    const sessionFiles = noteGen.listSessionFiles();
    if (sessionFiles.length > 0) {
      lines.push('## Session Notes');
      for (const file of sessionFiles.slice(-3)) {
        const content = noteGen.readSessionFile(file);
        if (content) {
          const sections = content.split('## ');
          for (const section of sections) {
            if (section.startsWith('Decisions') || section.startsWith('Key File Changes') || section.startsWith('Key Insights')) {
              lines.push('### ' + section.slice(0, 500));
            }
          }
        }
      }
      lines.push('');
    }

    // Next steps
    lines.push('## What To Do Next');
    lines.push('Continue working from this point. The user may ask you to:');
    lines.push('- Build on the existing code');
    lines.push('- Fix issues from the previous session');
    lines.push('- Take a different approach to something decided earlier');
    lines.push('- Understand why something was done a certain way');
    lines.push('');

    // Write the file
    const exportDir = pathMod.join(this.workspaceRoot, '.rewind', 'exports');
    if (!fs.existsSync(exportDir)) { fs.mkdirSync(exportDir, { recursive: true }); }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `rewindai-context-${commitSha.slice(0, 7)}-${timestamp}.md`;
    const filePath = pathMod.join(exportDir, filename);
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');

    // Open it in the editor
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
    } catch { /* skip */ }

    return filePath;
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
      neo4jConnected: this.neo4j?.isConnected() || false,
      rocketrideConnected: this.rocketride?.isConnected() || false,
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

  /* Header */
  .header {
    display: flex;
    align-items: center;
    padding: 4px 10px;
    background: var(--vscode-titleBar-activeBackground, var(--vscode-sideBar-background));
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }
  .header .brand { color: var(--vscode-textLink-foreground, #3794ff); }
  .header .version { opacity: 0.4; font-weight: normal; font-size: 10px; margin-left: 6px; }
  .header .spacer { flex: 1; }
  .header .gear-btn {
    background: none; border: none; color: var(--vscode-foreground); cursor: pointer;
    opacity: 0.5; font-size: 14px; padding: 2px 4px; line-height: 1;
  }
  .header .gear-btn:hover { opacity: 1; }
  .header .config-badge {
    font-size: 9px; padding: 1px 5px; border-radius: 3px; margin-left: 6px; font-weight: normal;
  }
  .header .config-badge.ok { background: rgba(78, 201, 176, 0.2); color: var(--vscode-charts-green, #4ec9b0); }
  .header .config-badge.missing { background: rgba(244, 68, 68, 0.2); color: var(--vscode-errorForeground, #f44); }

  /* Status bar */
  .status-bar {
    display: flex; align-items: center; gap: 8px; padding: 3px 10px;
    background: var(--vscode-titleBar-activeBackground, var(--vscode-sideBar-background));
    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
    font-size: 10px; flex-shrink: 0; flex-wrap: wrap; min-height: 20px;
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

  /* ── Setup / Config Screen ── */
  .setup-screen {
    flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px;
  }
  .setup-screen h2 {
    font-size: 14px; font-weight: 600; color: var(--vscode-textLink-foreground, #3794ff);
  }
  .setup-screen p { font-size: 12px; line-height: 1.5; opacity: 0.8; }
  .setup-screen label {
    font-size: 11px; font-weight: 600; display: block; margin-bottom: 4px;
    text-transform: uppercase; letter-spacing: 0.3px; opacity: 0.7;
  }
  .setup-screen .field { display: flex; flex-direction: column; gap: 2px; }
  .setup-screen .field-hint { font-size: 10px; opacity: 0.5; margin-top: 2px; }
  .setup-screen select,
  .setup-screen input[type="text"],
  .setup-screen input[type="password"] {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
    border-radius: 4px;
    padding: 6px 8px;
    font-family: inherit;
    font-size: 12px;
    outline: none;
  }
  .setup-screen select:focus,
  .setup-screen input:focus {
    border-color: var(--vscode-focusBorder, #007acc);
  }
  .setup-screen select { cursor: pointer; }
  .setup-screen .btn-primary {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 4px; padding: 8px 16px; cursor: pointer;
    font-size: 12px; font-weight: 600; width: 100%; margin-top: 4px;
  }
  .setup-screen .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .setup-screen .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .setup-screen .links {
    font-size: 11px; display: flex; gap: 12px; flex-wrap: wrap;
  }
  .setup-screen .links a {
    color: var(--vscode-textLink-foreground, #3794ff); text-decoration: none; cursor: pointer;
  }
  .setup-screen .links a:hover { text-decoration: underline; }
  .setup-screen .success-msg {
    background: rgba(78, 201, 176, 0.1); border: 1px solid var(--vscode-charts-green, #4ec9b0);
    border-radius: 4px; padding: 8px 10px; font-size: 12px; display: none;
  }
  .setup-screen .current-config {
    background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04));
    border-radius: 4px; padding: 8px 10px; font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .setup-screen .current-config .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .setup-screen .current-config .row .k { opacity: 0.5; }
  .setup-screen .toggle-vis {
    background: none; border: none; color: var(--vscode-textLink-foreground, #3794ff);
    cursor: pointer; font-size: 11px; padding: 0; margin-left: 6px;
  }

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

  /* Tool blocks */
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
  <span class="version">v0.3</span>
  <span class="config-badge missing" id="configBadge">No API Key</span>
  <span class="spacer"></span>
  <button class="gear-btn" id="gearBtn" title="Settings">&#9881;</button>
</div>

<div class="status-bar">
  <span class="stat"><span class="dot" id="statusDot"></span></span>
  <span class="stat"><span class="lbl">Msgs</span> <span class="val" id="msgCount">0</span></span>
  <span class="stat"><span class="lbl">Snaps</span> <span class="val" id="snapCount">0</span></span>
  <span class="stat"><span class="val" id="contextStatus">Fresh</span></span>
  <span class="stat"><span class="dot" id="neo4jDot" title="Neo4j"></span><span class="lbl">Neo4j</span></span>
  <span class="stat"><span class="dot" id="rocketrideDot" title="RocketRide"></span><span class="lbl">RR</span></span>
</div>

<div class="tab-bar">
  <button class="tab active" data-panel="chat">Chat</button>
  <button class="tab" data-panel="history">History</button>
  <button class="tab" data-panel="setup">Settings</button>
</div>

<!-- ── Chat Panel ── -->
<div class="panel active" id="panel-chat">
  <div class="messages" id="messages">
    <div class="msg assistant">
      <div class="role">RewindAI</div>
<strong>AI coding assistant with version-controlled memory.</strong>

I can read, edit, and create files, run terminal commands, and search your codebase.

When you commit, I save our context. When you checkout a different commit, I remember what we discussed there.</div>
  </div>
  <div class="typing" id="typing">Thinking...</div>
  <div class="input-area">
    <textarea id="input" rows="1" placeholder="Ask RewindAI to code..."></textarea>
    <button id="sendBtn">Send</button>
  </div>
</div>

<!-- ── History Panel ── -->
<div class="panel" id="panel-history">
  <div class="history-list" id="historyList">
    <div class="empty-state">No snapshots yet. Chat and commit to save context.</div>
  </div>
</div>

<!-- ── Setup Panel ── -->
<div class="panel" id="panel-setup">
  <div class="setup-screen">
    <h2>Configure RewindAI</h2>
    <p>Enter your API key to start coding with AI. Your key is stored locally in VS Code settings — never sent anywhere except the API you choose.</p>

    <div class="field">
      <label for="cfgProvider">Provider</label>
      <select id="cfgProvider">
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="openai">OpenAI (GPT)</option>
      </select>
    </div>

    <div class="field">
      <label for="cfgApiKey">API Key</label>
      <div style="display:flex; align-items:center;">
        <input type="password" id="cfgApiKey" placeholder="sk-ant-... or sk-..." style="flex:1;" />
        <button class="toggle-vis" id="toggleKeyVis">show</button>
      </div>
      <div class="field-hint" id="keyHint">Get a key from console.anthropic.com</div>
    </div>

    <div class="field">
      <label for="cfgModel">Model (optional)</label>
      <input type="text" id="cfgModel" placeholder="claude-sonnet-4-6" />
      <div class="field-hint">Leave blank for default. Examples: claude-sonnet-4-6, claude-opus-4-6, gpt-4o</div>
    </div>

    <button class="btn-primary" id="saveConfigBtn">Save & Start Coding</button>

    <div class="success-msg" id="successMsg">Settings saved! Switch to the Chat tab to start.</div>

    <div class="current-config" id="currentConfig" style="display:none;">
      <div style="font-weight:600; margin-bottom:4px; opacity:0.7;">Current Configuration</div>
      <div class="row"><span class="k">Provider</span> <span id="curProvider">—</span></div>
      <div class="row"><span class="k">API Key</span> <span id="curKey">—</span></div>
      <div class="row"><span class="k">Model</span> <span id="curModel">—</span></div>
    </div>

    <div class="links">
      <a id="linkAnthropic">Get Anthropic key</a>
      <a id="linkOpenAI">Get OpenAI key</a>
    </div>
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

  // Config elements
  const cfgProvider = document.getElementById('cfgProvider');
  const cfgApiKey = document.getElementById('cfgApiKey');
  const cfgModel = document.getElementById('cfgModel');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  const toggleKeyVis = document.getElementById('toggleKeyVis');
  const keyHint = document.getElementById('keyHint');
  const successMsg = document.getElementById('successMsg');
  const currentConfig = document.getElementById('currentConfig');
  const configBadge = document.getElementById('configBadge');
  const gearBtn = document.getElementById('gearBtn');

  let hasApiKey = false;

  // ── Tab switching ──
  function switchToPanel(panelName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const tab = document.querySelector('.tab[data-panel="' + panelName + '"]');
    if (tab) tab.classList.add('active');
    const panel = document.getElementById('panel-' + panelName);
    if (panel) panel.classList.add('active');
    if (panelName === 'history') vscode.postMessage({ type: 'getHistory' });
    if (panelName === 'setup') vscode.postMessage({ type: 'getConfig' });
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchToPanel(tab.dataset.panel));
  });

  // Gear button → settings tab
  gearBtn.addEventListener('click', () => switchToPanel('setup'));

  // ── Provider hint update ──
  cfgProvider.addEventListener('change', () => {
    const p = cfgProvider.value;
    keyHint.textContent = p === 'anthropic'
      ? 'Get a key from console.anthropic.com'
      : 'Get a key from platform.openai.com';
    cfgApiKey.placeholder = p === 'anthropic' ? 'sk-ant-api03-...' : 'sk-...';
    cfgModel.placeholder = p === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o';
  });

  // ── Toggle key visibility ──
  toggleKeyVis.addEventListener('click', () => {
    const isPassword = cfgApiKey.type === 'password';
    cfgApiKey.type = isPassword ? 'text' : 'password';
    toggleKeyVis.textContent = isPassword ? 'hide' : 'show';
  });

  // ── Save config ──
  saveConfigBtn.addEventListener('click', () => {
    const key = cfgApiKey.value.trim();
    if (!key) {
      cfgApiKey.style.borderColor = 'var(--vscode-errorForeground, #f44)';
      cfgApiKey.focus();
      return;
    }
    cfgApiKey.style.borderColor = '';
    saveConfigBtn.disabled = true;
    saveConfigBtn.textContent = 'Saving...';
    vscode.postMessage({
      type: 'saveConfig',
      provider: cfgProvider.value,
      apiKey: key,
      model: cfgModel.value.trim(),
    });
  });

  // ── Link clicks ──
  document.getElementById('linkAnthropic').addEventListener('click', () => {
    vscode.postMessage({ type: 'chat', text: '' }); // no-op, just trigger
  });
  document.getElementById('linkOpenAI').addEventListener('click', () => {
    vscode.postMessage({ type: 'chat', text: '' });
  });

  // ── Send message ──
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

  // ── Handle messages from extension ──
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'clearChat': {
        // Remove all messages except the welcome message
        const msgs = messagesEl.querySelectorAll('.msg, .tool-block');
        msgs.forEach(m => m.remove());
        break;
      }
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
        document.getElementById('neo4jDot').className = 'dot' + (msg.neo4jConnected ? '' : ' inactive');
        document.getElementById('rocketrideDot').className = 'dot' + (msg.rocketrideConnected ? '' : ' inactive');
        break;
      case 'config': {
        hasApiKey = msg.hasApiKey;
        // Update badge
        if (msg.hasApiKey) {
          configBadge.textContent = msg.provider === 'anthropic' ? 'Claude' : 'GPT';
          configBadge.className = 'config-badge ok';
        } else {
          configBadge.textContent = 'No API Key';
          configBadge.className = 'config-badge missing';
        }
        // Update settings form
        cfgProvider.value = msg.provider || 'anthropic';
        if (msg.model) cfgModel.value = msg.model;
        // Update current config display
        if (msg.hasApiKey) {
          currentConfig.style.display = 'block';
          document.getElementById('curProvider').textContent = msg.provider;
          document.getElementById('curKey').textContent = msg.apiKeyPreview;
          document.getElementById('curModel').textContent = msg.model || '(default)';
        } else {
          currentConfig.style.display = 'none';
        }
        // If no API key, auto-switch to setup on first load
        if (!msg.hasApiKey && document.querySelector('.tab[data-panel="chat"]').classList.contains('active')) {
          // Only auto-switch if there are no messages yet (first load)
          if (messagesEl.children.length <= 1) {
            switchToPanel('setup');
          }
        }
        break;
      }
      case 'configSaved': {
        saveConfigBtn.disabled = false;
        saveConfigBtn.textContent = 'Save & Start Coding';
        successMsg.style.display = 'block';
        cfgApiKey.value = '';
        showToast('API key saved!');
        // Auto-switch to chat after 1.5s
        setTimeout(() => {
          successMsg.style.display = 'none';
          switchToPanel('chat');
        }, 1500);
        break;
      }
      case 'showSetup':
        switchToPanel('setup');
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
  vscode.postMessage({ type: 'getConfig' });
</script>
</body>
</html>`;
  }
}
