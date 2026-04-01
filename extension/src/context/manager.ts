import * as fs from 'fs';
import * as path from 'path';
import { BackendClient } from '../backend/client';
import { SessionNoteGenerator } from './sessionNotes';

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
    scratchpad: string[];
  };
  tokenCount: number;
  sessionFiles?: string[];
  compactedFiles?: string[];
}

/**
 * Manages context snapshots stored as files in .rewind/snapshots/.
 * Tracks conversation, decisions, and a scratchpad for session notes.
 */
export class ContextManager {
  private rewindDir: string;
  private snapshotsDir: string;
  private currentContext: ContextSnapshot | null = null;
  private conversationMessages: Array<{ role: string; content: string }> = [];
  private filesDiscussed: Set<string> = new Set();
  private scratchpad: string[] = [];

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
    const sessionsDir = path.join(this.rewindDir, 'sessions');
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }
    const gitignorePath = path.join(this.rewindDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, 'snapshots/\nsessions/\n');
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

  /** Add a note to the scratchpad (key decisions, important context) */
  addToScratchpad(note: string): void {
    this.scratchpad.push(`[${new Date().toISOString().slice(11, 19)}] ${note}`);
    if (this.scratchpad.length > 50) {
      this.scratchpad = this.scratchpad.slice(-50);
    }
  }

  getScratchpad(): string[] {
    return [...this.scratchpad];
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

    if (this.scratchpad.length > 0) {
      summary += '\nScratchpad (key notes from this session):\n';
      for (const note of this.scratchpad) {
        summary += `- ${note}\n`;
      }
    }

    // Include session note context
    const noteGen = new SessionNoteGenerator(this.workspaceRoot);
    const sessionContext = noteGen.buildContextFromSessions();
    if (sessionContext) {
      summary += '\n\n' + sessionContext;
    }

    return summary;
  }

  async saveSnapshot(
    commitSha: string,
    branch: string,
    commitMessage: string,
  ): Promise<void> {
    // Include session file references in the snapshot
    const noteGen = new SessionNoteGenerator(this.workspaceRoot);
    const sessionFiles = noteGen.listSessionFiles();
    const compactedFiles = noteGen.listCompactedFiles();

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
        scratchpad: [...this.scratchpad],
      },
      tokenCount: this.estimateTokenCount(),
      sessionFiles: sessionFiles.slice(0, 20),
      compactedFiles: compactedFiles.slice(0, 5),
    };

    const filePath = path.join(this.snapshotsDir, `${commitSha}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

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

  async loadSnapshotForCommit(commitSha: string): Promise<boolean> {
    const filePath = path.join(this.snapshotsDir, `${commitSha}.json`);

    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const snapshot: ContextSnapshot = JSON.parse(raw);
        this.currentContext = snapshot;
        this.conversationMessages = [...snapshot.context.messages];
        this.filesDiscussed = new Set(snapshot.context.filesDiscussed);
        this.scratchpad = snapshot.context.scratchpad || [];

        // Look for parent commit context to provide continuity
        this.injectParentContext(snapshot);

        if (snapshot.sessionFiles && snapshot.sessionFiles.length > 0) {
          console.log(`RewindAI: ${snapshot.sessionFiles.length} session notes available for this commit`);
        }

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
            scratchpad: [],
          },
          tokenCount: resp.snapshot.token_count,
        };
        this.conversationMessages = [];
        this.filesDiscussed = new Set(resp.files_discussed);
        this.scratchpad = [];
        return true;
      }
    } catch {
      // Backend unavailable
    }

    this.currentContext = null;
    this.conversationMessages = [];
    this.filesDiscussed = new Set();
    this.scratchpad = [];
    return false;
  }

  /** Find the closest earlier snapshot and inject a summary as background */
  private injectParentContext(current: ContextSnapshot): void {
    const allSnapshots = this.listSnapshots();
    const currentTime = new Date(current.timestamp).getTime();
    let parentSnapshot: ContextSnapshot | null = null;
    let parentTime = 0;

    for (const sha of allSnapshots) {
      if (sha === current.commitSha) { continue; }
      try {
        const pPath = path.join(this.snapshotsDir, `${sha}.json`);
        const pRaw = fs.readFileSync(pPath, 'utf-8');
        const pSnap: ContextSnapshot = JSON.parse(pRaw);
        const pTime = new Date(pSnap.timestamp).getTime();
        if (pTime < currentTime && pTime > parentTime) {
          parentSnapshot = pSnap;
          parentTime = pTime;
        }
      } catch { /* skip */ }
    }

    if (parentSnapshot) {
      this.scratchpad.unshift(
        `PRIOR COMMIT (${parentSnapshot.commitSha.slice(0, 7)}): ${parentSnapshot.context.summary}`
      );
    }
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
    this.scratchpad = [];
  }

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
        /(?:I recommend|Let's use|We should|I chose|I suggest|The best approach is|I'll use|Decision:)\s+([^.!?\n]+)/gi,
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
    // Also include scratchpad decisions
    for (const note of this.scratchpad) {
      if (note.includes('DECISION:')) {
        const content = note.replace(/^\[.*?\]\s*DECISION:\s*/, '');
        decisions.push({ content, rationale: 'From scratchpad' });
      }
    }
    return decisions.slice(0, 15);
  }

  private estimateTokenCount(): number {
    const text = this.conversationMessages.map(m => m.content).join(' ');
    return Math.ceil(text.length / 4);
  }
}
