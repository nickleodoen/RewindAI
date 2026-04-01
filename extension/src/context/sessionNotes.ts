/**
 * SessionNoteGenerator — Creates detailed markdown notes for each prompt/response cycle.
 *
 * After the agentic loop completes, this generator creates a structured .md file
 * capturing everything that happened: tool calls, file changes, decisions, insights.
 * Files are written to .rewind/sessions/ with timestamped filenames.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

export interface SessionEvent {
  type: 'user_message' | 'assistant_text' | 'tool_call' | 'tool_result' | 'decision' | 'error';
  timestamp: string;
  content: string;
  toolName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolInput?: Record<string, any>;
  isError?: boolean;
}

export interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted' | 'read';
  diff?: string;
  afterSnippet?: string;
  linesChanged?: number;
}

export interface SessionNote {
  id: string;
  timestamp: string;
  userPrompt: string;
  shortTitle: string;
  durationMs: number;
  events: SessionEvent[];
  filesModified: FileChange[];
  filesRead: string[];
  decisions: Array<{ content: string; rationale: string }>;
  commandsRun: Array<{ command: string; output: string; exitCode: number }>;
  assistantResponse: string;
  keyInsights: string[];
  errors: string[];
  tokenEstimate: number;
}

export class SessionNoteGenerator {
  private sessionsDir: string;
  private currentEvents: SessionEvent[] = [];
  private currentFilesModified: Map<string, FileChange> = new Map();
  private currentFilesRead: Set<string> = new Set();
  private currentCommands: Array<{ command: string; output: string; exitCode: number }> = [];
  private currentDecisions: Array<{ content: string; rationale: string }> = [];
  private sessionStartTime: number = 0;

  constructor(private workspaceRoot: string) {
    this.sessionsDir = path.join(workspaceRoot, '.rewind', 'sessions');
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /** Start tracking a new session (called when user sends a prompt). */
  startSession(): void {
    this.sessionStartTime = Date.now();
    this.currentEvents = [];
    this.currentFilesModified = new Map();
    this.currentFilesRead = new Set();
    this.currentCommands = [];
    this.currentDecisions = [];
  }

  /** Record an event during the session. */
  recordEvent(event: Omit<SessionEvent, 'timestamp'>): void {
    this.currentEvents.push({
      ...event,
      timestamp: new Date().toISOString(),
    });

    if (event.type === 'tool_call' && event.toolName === 'read_file' && event.toolInput?.path) {
      this.currentFilesRead.add(event.toolInput.path);
    }

    if (event.type === 'tool_result' && event.toolName) {
      if ((event.toolName === 'write_file' || event.toolName === 'edit_file') && event.toolInput?.path) {
        this.currentFilesModified.set(event.toolInput.path, {
          path: event.toolInput.path,
          type: event.toolName === 'write_file' ? 'created' : 'modified',
        });
      }
      if (event.toolName === 'delete_file' && event.toolInput?.path) {
        this.currentFilesModified.set(event.toolInput.path, { path: event.toolInput.path, type: 'deleted' });
      }
      if (event.toolName === 'run_command' && event.toolInput?.command) {
        this.currentCommands.push({
          command: event.toolInput.command,
          output: event.content?.slice(0, 1000) || '',
          exitCode: event.isError ? 1 : 0,
        });
      }
    }

    if (event.type === 'decision') {
      this.currentDecisions.push({
        content: event.content,
        rationale: event.toolInput?.rationale || 'Extracted from conversation',
      });
    }
  }

  /** Record a file modification with its diff. */
  recordFileChange(filePath: string, changeType: 'created' | 'modified' | 'deleted'): void {
    this.currentFilesModified.set(filePath, { path: filePath, type: changeType });
  }

  /** Record a decision made during the session. */
  recordDecision(content: string, rationale: string): void {
    this.currentDecisions.push({ content, rationale });
  }

  /**
   * End the session and generate the .md file.
   * Returns the path to the generated file.
   */
  async endSession(userPrompt: string, assistantResponse: string): Promise<string> {
    const durationMs = Date.now() - this.sessionStartTime;
    const timestamp = new Date().toISOString();
    const shortTitle = this.generateShortTitle(userPrompt);
    const id = this.generateId(timestamp, shortTitle);

    await this.collectGitDiffs();
    const keyInsights = this.extractKeyInsights(assistantResponse);
    this.autoDetectDecisions(assistantResponse);

    const note: SessionNote = {
      id,
      timestamp,
      userPrompt,
      shortTitle,
      durationMs,
      events: this.currentEvents,
      filesModified: Array.from(this.currentFilesModified.values()),
      filesRead: Array.from(this.currentFilesRead).filter(f => !this.currentFilesModified.has(f)),
      decisions: this.currentDecisions,
      commandsRun: this.currentCommands,
      assistantResponse,
      keyInsights,
      errors: this.currentEvents.filter(e => e.isError).map(e => e.content),
      tokenEstimate: this.estimateTokens(userPrompt, assistantResponse),
    };

    const markdown = this.generateMarkdown(note);
    const filename = `${this.formatTimestamp(timestamp)}_${this.slugify(shortTitle)}.md`;
    const filePath = path.join(this.sessionsDir, filename);
    fs.writeFileSync(filePath, markdown, 'utf-8');

    const jsonPath = filePath.replace('.md', '.json');
    fs.writeFileSync(jsonPath, JSON.stringify(note, null, 2), 'utf-8');

    return filePath;
  }

  /** Get all session .md files, sorted newest first. */
  listSessionFiles(): string[] {
    if (!fs.existsSync(this.sessionsDir)) { return []; }
    return fs.readdirSync(this.sessionsDir)
      .filter(f => f.endsWith('.md') && !f.includes('_compacted'))
      .sort()
      .reverse();
  }

  /** Get the rolling summary file if it exists. */
  listCompactedFiles(): string[] {
    if (!fs.existsSync(this.sessionsDir)) { return []; }
    return fs.readdirSync(this.sessionsDir)
      .filter(f => f === '_current_summary.md');
  }

  /** Read a session file's content. */
  readSessionFile(filename: string): string {
    const filePath = path.join(this.sessionsDir, filename);
    if (!fs.existsSync(filePath)) { return ''; }
    return fs.readFileSync(filePath, 'utf-8');
  }

  /** Count sessions since the last compaction. */
  getSessionCountSinceLastCompaction(): number {
    const sessions = this.listSessionFiles();
    const compacted = this.listCompactedFiles();
    if (compacted.length === 0) { return sessions.length; }
    const lastCompactedTime = compacted[0].split('_compacted')[0];
    return sessions.filter(s => s > lastCompactedTime).length;
  }

  /**
   * Build a context string from session files for injecting into the system prompt.
   * Prefers the rolling _current_summary.md; falls back to last 3 raw sessions.
   */
  buildContextFromSessions(): string {
    // Load the rolling summary
    const summaryPath = path.join(this.sessionsDir, '_current_summary.md');
    let context = '';

    if (fs.existsSync(summaryPath)) {
      const summary = fs.readFileSync(summaryPath, 'utf-8');
      if (summary.trim()) {
        context += '═══ SESSION HISTORY (Compacted Summary) ═══\n\n';
        // Truncate to ~2000 tokens (8000 chars) to leave room in the context window
        context += summary.slice(0, 8000);
        if (summary.length > 8000) {
          context += '\n\n... (summary truncated)\n';
        }
      }
    }

    // If no summary exists, load the last 3 raw session files as fallback
    if (!context) {
      const sessions = this.listSessionFiles();
      if (sessions.length > 0) {
        context += '═══ RECENT SESSIONS ═══\n\n';
        for (const file of sessions.slice(0, 3)) {
          const content = this.readSessionFile(file);
          if (content) {
            // Just take the header and decisions
            const lines = content.split('\n');
            const abbreviated = lines.slice(0, 15).join('\n');
            context += abbreviated + '\n---\n';
          }
        }
      }
    }

    return context;
  }

  // ── Private helpers ──

  private generateMarkdown(note: SessionNote): string {
    const lines: string[] = [];

    lines.push(`# Session: ${note.shortTitle}`);
    lines.push(`**Timestamp:** ${note.timestamp}`);
    lines.push(`**Duration:** ${(note.durationMs / 1000).toFixed(1)}s`);
    lines.push(`**Files Modified:** ${note.filesModified.map(f => f.path).join(', ') || 'none'}`);
    lines.push(`**Files Read:** ${note.filesRead.join(', ') || 'none'}`);
    lines.push(`**Tools Used:** ${this.summarizeToolUsage()}`);
    lines.push(`**Token Estimate:** ~${note.tokenEstimate}`);
    lines.push('');

    lines.push('## User Prompt');
    lines.push('```');
    lines.push(note.userPrompt);
    lines.push('```');
    lines.push('');

    lines.push('## What Was Done');
    let stepNum = 1;
    for (const event of note.events) {
      if (event.type === 'tool_call' && event.toolName) {
        const inputStr = event.toolInput ? JSON.stringify(event.toolInput) : '';
        const shortInput = inputStr.length > 100 ? inputStr.slice(0, 100) + '...' : inputStr;
        lines.push(`${stepNum}. **${event.toolName}** — ${shortInput}`);
        stepNum++;
      }
      if (event.type === 'tool_result' && event.isError) {
        lines.push(`   - Error: ${event.content.slice(0, 200)}`);
      }
    }
    if (stepNum === 1) { lines.push('Direct response — no tool calls needed.'); }
    lines.push('');

    if (note.decisions.length > 0) {
      lines.push('## Decisions Made');
      for (const d of note.decisions) {
        lines.push(`- **Decision:** ${d.content}`);
        if (d.rationale && d.rationale !== 'Extracted from conversation' && d.rationale !== 'Auto-detected from response') {
          lines.push(`  - **Rationale:** ${d.rationale}`);
        }
      }
      lines.push('');
    }

    if (note.filesModified.length > 0) {
      lines.push('## Key File Changes');
      for (const fc of note.filesModified) {
        lines.push(`### ${fc.path} (${fc.type})`);
        if (fc.diff) {
          lines.push('```diff');
          const diffLines = fc.diff.split('\n');
          lines.push(diffLines.slice(0, 30).join('\n'));
          if (diffLines.length > 30) { lines.push(`... (${diffLines.length - 30} more lines)`); }
          lines.push('```');
        } else if (fc.afterSnippet) {
          lines.push('```');
          lines.push(fc.afterSnippet);
          lines.push('```');
        }
      }
      lines.push('');
    }

    if (note.commandsRun.length > 0) {
      lines.push('## Commands Run');
      for (const cmd of note.commandsRun) {
        lines.push(`### \`${cmd.command}\``);
        if (cmd.output) {
          lines.push('```');
          lines.push(cmd.output.slice(0, 500));
          if (cmd.output.length > 500) { lines.push('... (truncated)'); }
          lines.push('```');
        }
        if (cmd.exitCode !== 0) { lines.push(`Exit code: ${cmd.exitCode}`); }
      }
      lines.push('');
    }

    if (note.keyInsights.length > 0) {
      lines.push('## Key Insights');
      for (const insight of note.keyInsights) { lines.push(`- ${insight}`); }
      lines.push('');
    }

    lines.push('## Assistant Response');
    const responseLines = note.assistantResponse.split('\n');
    if (responseLines.length > 30) {
      lines.push(responseLines.slice(0, 25).join('\n'));
      lines.push(`\n... (${responseLines.length - 25} more lines)`);
    } else {
      lines.push(note.assistantResponse);
    }
    lines.push('');

    if (note.errors.length > 0) {
      lines.push('## Errors Encountered');
      for (const err of note.errors) { lines.push(`- ${err.slice(0, 200)}`); }
      lines.push('');
    }

    lines.push('## Open Questions / Follow-ups');
    const questions = this.extractOpenQuestions(note.assistantResponse);
    if (questions.length > 0) {
      for (const q of questions) { lines.push(`- ${q}`); }
    } else {
      lines.push('- (none identified)');
    }
    lines.push('');

    return lines.join('\n');
  }

  private async collectGitDiffs(): Promise<void> {
    for (const [filePath, change] of this.currentFilesModified) {
      try {
        const diff = await this.getGitDiff(filePath);
        if (diff) { change.diff = diff; }
      } catch { /* skip */ }

      try {
        const fullPath = path.join(this.workspaceRoot, filePath);
        if (fs.existsSync(fullPath) && change.type !== 'deleted') {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          change.afterSnippet = lines.slice(0, 20).join('\n');
          change.linesChanged = lines.length;
        }
      } catch { /* skip */ }
    }
  }

  private getGitDiff(filePath: string): Promise<string> {
    return new Promise((resolve) => {
      exec(
        `git diff -- "${filePath}" 2>/dev/null || git diff HEAD -- "${filePath}" 2>/dev/null`,
        { cwd: this.workspaceRoot, timeout: 5000 },
        (_error, stdout) => { resolve(stdout?.trim() || ''); },
      );
    });
  }

  private generateShortTitle(prompt: string): string {
    const cleaned = prompt.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
    const shortened = cleaned.slice(0, 50);
    const lastSpace = shortened.lastIndexOf(' ');
    return lastSpace > 20 ? shortened.slice(0, lastSpace) : shortened;
  }

  private generateId(timestamp: string, title: string): string {
    return `${this.formatTimestamp(timestamp)}_${this.slugify(title)}`;
  }

  private formatTimestamp(iso: string): string {
    return iso.replace(/T/, '_').replace(/:/g, '-').slice(0, 19);
  }

  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }

  private summarizeToolUsage(): string {
    const counts: Record<string, number> = {};
    for (const event of this.currentEvents) {
      if (event.type === 'tool_call' && event.toolName) {
        counts[event.toolName] = (counts[event.toolName] || 0) + 1;
      }
    }
    if (Object.keys(counts).length === 0) { return 'none'; }
    return Object.entries(counts).map(([name, count]) => `${name} (${count})`).join(', ');
  }

  private extractKeyInsights(response: string): string[] {
    const insights: string[] = [];
    const patterns = [
      /(?:Key insight|Important|Note|Observation|Found that|Discovered|Noticed):\s*(.{15,150})/gi,
      /(?:The (?:main |key |core )?(?:issue|problem|cause|reason|fix|solution) (?:is|was))(.{15,100})/gi,
    ];
    for (const pattern of patterns) {
      for (const match of response.matchAll(pattern)) { insights.push(match[1].trim()); }
    }
    return insights.slice(0, 5);
  }

  private extractOpenQuestions(response: string): string[] {
    const questions: string[] = [];
    const patterns = [
      /(?:Should we|Could we|Would it|Do you want|Shall I|Would you like)\s+([^.?!]{10,80})\??/gi,
      /(?:TODO|FIXME|NOTE):\s*(.{10,100})/gi,
    ];
    for (const pattern of patterns) {
      for (const match of response.matchAll(pattern)) { questions.push(match[1].trim()); }
    }
    return questions.slice(0, 5);
  }

  private autoDetectDecisions(response: string): void {
    const patterns = [
      /Decision:\s*(.{10,150}?)(?:\n|$)/gi,
      /(?:I(?:'ll| will) use|Let's (?:use|go with)|We should (?:use|go with)|Choosing|Going with)\s+(.{10,80})/gi,
    ];
    for (const pattern of patterns) {
      for (const match of response.matchAll(pattern)) {
        const content = match[1].trim();
        if (!this.currentDecisions.some(d => d.content === content)) {
          this.currentDecisions.push({ content, rationale: 'Auto-detected from response' });
        }
      }
    }
  }

  private estimateTokens(prompt: string, response: string): number {
    const allText = prompt + response + this.currentEvents.map(e => e.content).join(' ');
    return Math.ceil(allText.length / 4);
  }
}
