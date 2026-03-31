import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ContextManager } from '../context/manager';
import { BackendClient } from '../backend/client';

const SYSTEM_PROMPT = `You are RewindAI, an AI coding assistant with version-controlled memory.

You help developers understand and work with their codebase. You can read files, explain code, suggest changes, and answer questions about the project.

Your memory is tied to git commits. When the developer navigates to a different commit, your context changes to match what you knew at that point in time. Answer based on what you know from the conversation history at the current commit.

If you have restored context from a previous session, it is provided below. Use it to maintain continuity.
If no prior context exists, introduce yourself and offer to help.`;

/**
 * @rewind chat participant. Answers questions about the repo with context
 * injected from .rewind/snapshots/. No manual snapshot/restore — everything
 * is automatic via GitWatcher.
 */
export class RewindChatParticipant implements vscode.Disposable {
  private participant: vscode.ChatParticipant;
  private backend: BackendClient;

  constructor(
    private extensionContext: vscode.ExtensionContext,
    private contextManager: ContextManager,
    private workspaceRoot: string,
  ) {
    this.backend = new BackendClient();
    this.participant = vscode.chat.createChatParticipant(
      'rewindai.rewind',
      this.handleRequest.bind(this),
    );
    this.participant.iconPath = vscode.Uri.joinPath(extensionContext.extensionUri, 'icon.png');
  }

  private async handleRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> {
    if (request.command === 'history') {
      await this.handleHistory(stream);
      return {};
    }
    if (request.command === 'status') {
      await this.handleStatus(stream);
      return {};
    }

    await this.handleChat(request, stream, token);
    return {};
  }

  private async handleChat(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const userMessage = request.prompt;
    this.contextManager.addMessage('user', userMessage);

    // Build system prompt with restored context
    let systemPrompt = SYSTEM_PROMPT;
    const restoredContext = this.contextManager.getCurrentContextSummary();
    if (restoredContext) {
      systemPrompt += '\n\n--- RESTORED CONTEXT ---\n' + restoredContext + '\n--- END RESTORED CONTEXT ---';
    }

    // Gather file context if the user mentions file paths
    const fileContext = this.gatherFileContext(userMessage);
    if (fileContext) {
      systemPrompt += '\n\n--- RELEVANT FILES ---\n' + fileContext + '\n--- END RELEVANT FILES ---';
    }

    const messages = this.contextManager.getMessages();

    // Try backend (Claude API) first
    try {
      const result = await this.backend.chat(userMessage, systemPrompt, messages);
      stream.markdown(result.response);
      this.contextManager.addMessage('assistant', result.response);
      return;
    } catch {
      // Backend unavailable — try VS Code LM API fallback
    }

    // Fallback: VS Code language model API
    try {
      const models = await vscode.lm.selectChatModels({ family: 'claude-sonnet' });
      if (models.length > 0) {
        const lmMessages = [
          vscode.LanguageModelChatMessage.User(
            systemPrompt + '\n\nUser question: ' + userMessage,
          ),
        ];
        const response = await models[0].sendRequest(lmMessages, {}, token);
        let fullResponse = '';
        for await (const chunk of response.text) {
          stream.markdown(chunk);
          fullResponse += chunk;
        }
        this.contextManager.addMessage('assistant', fullResponse);
        return;
      }
    } catch {
      // LM API also unavailable
    }

    // Final fallback: helpful error
    stream.markdown(
      '**RewindAI backend is not running.** Start it with:\n\n```bash\ncd backend && python3 -m uvicorn app.main:app --reload\n```\n\n' +
      '*Your conversation is still being tracked locally. When you commit, context will be saved.*\n',
    );
    this.contextManager.addMessage('assistant', '[backend unavailable]');
  }

  private async handleHistory(stream: vscode.ChatResponseStream): Promise<void> {
    const snapshots = this.contextManager.listSnapshots();

    if (snapshots.length === 0) {
      stream.markdown('No context snapshots yet. Chat and make a commit — context is saved automatically.\n');
      return;
    }

    stream.markdown(`**RewindAI Context History** (${snapshots.length} snapshots)\n\n`);

    for (const sha of snapshots.slice(0, 20)) {
      try {
        const filePath = path.join(this.workspaceRoot, '.rewind', 'snapshots', `${sha}.json`);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const snapshot = JSON.parse(raw);
        const msgCount = snapshot.context?.messages?.length ?? 0;
        stream.markdown(
          `- \`${sha.slice(0, 7)}\` — ${snapshot.commitMessage?.slice(0, 60) || 'No message'} ` +
          `(${msgCount} msgs, ${snapshot.context?.decisions?.length ?? 0} decisions)\n`,
        );
      } catch {
        stream.markdown(`- \`${sha.slice(0, 7)}\`\n`);
      }
    }

    stream.markdown('\nNavigate to any commit with `git checkout <sha>` and context auto-restores.\n');
  }

  private async handleStatus(stream: vscode.ChatResponseStream): Promise<void> {
    const messages = this.contextManager.getMessages();
    const summary = this.contextManager.getCurrentContextSummary();
    const snapshots = this.contextManager.listSnapshots();

    stream.markdown('**RewindAI Status**\n\n');
    stream.markdown(`- Messages in session: **${messages.length}**\n`);
    stream.markdown(`- Restored context: **${summary ? 'Yes' : 'No (fresh session)'}**\n`);
    stream.markdown(`- Token estimate: **~${Math.ceil(messages.map(m => m.content).join('').length / 4)}**\n`);
    stream.markdown(`- Total snapshots saved: **${snapshots.length}**\n`);
  }

  private gatherFileContext(userMessage: string): string | null {
    const filePattern = /(?:^|\s)([\w./-]+\.\w{1,10})/g;
    const parts: string[] = [];

    for (const match of userMessage.matchAll(filePattern)) {
      const filePath = match[1];
      const fullPath = path.join(this.workspaceRoot, filePath);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.length < 10000) {
            parts.push(`--- ${filePath} ---\n${content}\n`);
            this.contextManager.trackFile(filePath);
          }
        } catch { /* skip unreadable files */ }
      }
    }

    return parts.length > 0 ? parts.join('\n') : null;
  }

  dispose(): void {
    this.participant.dispose();
  }
}
