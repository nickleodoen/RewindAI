import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BackendClient } from '../backend/client';

export interface ContextSnapshot {
  commitSha: string;
  branch: string;
  timestamp: string;
  commitMessage: string;
  context: {
    messages: Array<{ role: string; content: string }>;
    summary: string;
    decisions: Array<{ content: string; rationale: string }>;
    filesDiscussed: string[];
  };
  tokenCount: number;
}

/**
 * Manages context snapshots stored as files in .rewind/snapshots/.
 * Snapshots travel with the repo and are indexed in Neo4j for cross-commit queries.
 */
export class ContextManager {
  private rewindDir: string;
  private snapshotsDir: string;
  private currentContext: ContextSnapshot | null = null;
  private conversationMessages: Array<{ role: string; content: string }> = [];
  private filesDiscussed: Set<string> = new Set();

  constructor(
    private workspaceRoot: string,
    private backend: BackendClient,
  ) {
    this.rewindDir = path.join(workspaceRoot, '.rewind');
    this.snapshotsDir = path.join(this.rewindDir, 'snapshots');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.rewindDir)) {
      fs.mkdirSync(this.rewindDir, { recursive: true });
    }
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }
    // Default: don't commit snapshots (they contain conversation history).
    // Users can remove this .gitignore to share team context.
    const gitignorePath = path.join(this.rewindDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, 'snapshots/\n');
    }
  }

  addMessage(role: string, content: string): void {
    this.conversationMessages.push({ role, content });
  }

  trackFile(filePath: string): void {
    this.filesDiscussed.add(filePath);
  }

  getMessages(): Array<{ role: string; content: string }> {
    return [...this.conversationMessages];
  }

  getCurrentContextSummary(): string | null {
    if (!this.currentContext) { return null; }

    let summary = `RESTORED CONTEXT FROM COMMIT ${this.currentContext.commitSha.slice(0, 7)}:\n`;
    summary += `Commit: "${this.currentContext.commitMessage}"\n`;
    summary += `Branch: ${this.currentContext.branch}\n`;
    summary += `\nSummary: ${this.currentContext.context.summary}\n`;

    if (this.currentContext.context.decisions.length > 0) {
      summary += '\nDecisions made at this point:\n';
      for (const d of this.currentContext.context.decisions) {
        summary += `- ${d.content} (${d.rationale})\n`;
      }
    }

    if (this.currentContext.context.filesDiscussed.length > 0) {
      summary += `\nFiles discussed: ${this.currentContext.context.filesDiscussed.join(', ')}\n`;
    }

    if (this.currentContext.context.messages.length > 0) {
      summary += '\nPrevious conversation:\n';
      for (const msg of this.currentContext.context.messages.slice(-20)) {
        summary += `[${msg.role}]: ${msg.content.slice(0, 500)}\n`;
      }
    }

    return summary;
  }

  /** Save a snapshot for a commit to .rewind/snapshots/{sha}.json */
  async saveSnapshot(
    commitSha: string,
    branch: string,
    commitMessage: string,
  ): Promise<void> {
    const snapshot: ContextSnapshot = {
      commitSha,
      branch,
      timestamp: new Date().toISOString(),
      commitMessage,
      context: {
        messages: [...this.conversationMessages],
        summary: this.generateSummary(),
        decisions: this.extractDecisions(),
        filesDiscussed: [...this.filesDiscussed],
      },
      tokenCount: this.estimateTokenCount(),
    };

    const filePath = path.join(this.snapshotsDir, `${commitSha}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

    // Also index in Neo4j via backend (best-effort)
    try {
      await this.backend.createSnapshot({
        sha: commitSha,
        branch,
        commit_message: commitMessage,
        messages: this.conversationMessages,
      });
    } catch {
      console.log('RewindAI: Backend unavailable, snapshot saved locally only');
    }

    this.currentContext = snapshot;
  }

  /** Load a snapshot for a commit (on checkout). File first, backend fallback. */
  async loadSnapshotForCommit(commitSha: string): Promise<boolean> {
    const filePath = path.join(this.snapshotsDir, `${commitSha}.json`);

    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const snapshot: ContextSnapshot = JSON.parse(raw);
        this.currentContext = snapshot;
        this.conversationMessages = [...snapshot.context.messages];
        this.filesDiscussed = new Set(snapshot.context.filesDiscussed);
        return true;
      } catch (e) {
        console.error('RewindAI: Failed to parse snapshot', e);
      }
    }

    // Fallback: try backend
    try {
      const resp = await this.backend.getSnapshot(commitSha);
      if (resp) {
        this.currentContext = {
          commitSha,
          branch: resp.snapshot.branch,
          timestamp: resp.snapshot.timestamp,
          commitMessage: resp.snapshot.commit_message,
          context: {
            messages: [],
            summary: resp.summary,
            decisions: resp.decisions.map(d => ({
              content: d.content,
              rationale: d.rationale,
            })),
            filesDiscussed: resp.files_discussed,
          },
          tokenCount: resp.snapshot.token_count,
        };
        this.conversationMessages = [];
        this.filesDiscussed = new Set(resp.files_discussed);
        return true;
      }
    } catch {
      // Backend unavailable
    }

    // No snapshot — start fresh
    this.currentContext = null;
    this.conversationMessages = [];
    this.filesDiscussed = new Set();
    return false;
  }

  hasSnapshot(commitSha: string): boolean {
    return fs.existsSync(path.join(this.snapshotsDir, `${commitSha}.json`));
  }

  listSnapshots(): string[] {
    if (!fs.existsSync(this.snapshotsDir)) { return []; }
    return fs.readdirSync(this.snapshotsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  resetConversation(): void {
    this.conversationMessages = [];
    this.filesDiscussed = new Set();
  }

  // --- Helpers ---

  private generateSummary(): string {
    if (this.conversationMessages.length === 0) { return 'No conversation history.'; }
    const userMessages = this.conversationMessages.filter(m => m.role === 'user');
    if (userMessages.length === 0) { return 'No user messages.'; }
    const first = userMessages[0].content.slice(0, 100);
    return `${userMessages.length} messages. Started with: "${first}..."`;
  }

  private extractDecisions(): Array<{ content: string; rationale: string }> {
    const decisions: Array<{ content: string; rationale: string }> = [];
    for (const msg of this.conversationMessages) {
      if (msg.role !== 'assistant') { continue; }
      const patterns = [
        /(?:I recommend|Let's use|We should|I chose|I suggest|The best approach is|I'll use)\s+([^.!?]+)/gi,
      ];
      for (const pattern of patterns) {
        for (const match of msg.content.matchAll(pattern)) {
          decisions.push({
            content: match[1].trim().slice(0, 200),
            rationale: 'Extracted from conversation',
          });
        }
      }
    }
    return decisions.slice(0, 10);
  }

  private estimateTokenCount(): number {
    const text = this.conversationMessages.map(m => m.content).join(' ');
    return Math.ceil(text.length / 4);
  }
}
