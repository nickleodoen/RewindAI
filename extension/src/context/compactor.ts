/**
 * SessionCompactor — Compacts session notes after every prompt into a rolling summary.
 *
 * Maintains a single `_current_summary.md` file that gets rewritten after every prompt.
 * This replaces the old strategy of creating timestamped `_compacted.md` files every 5 sessions.
 *
 * After each prompt:
 * 1. Reads ALL session .md files (excluding _current_summary.md)
 * 2. Extracts: decisions, file changes, key insights, errors
 * 3. Drops: verbose tool outputs, repeated file reads, debugging loops
 * 4. Produces/overwrites `_current_summary.md`
 */

import * as fs from 'fs';
import * as path from 'path';
import { RocketRideClient } from '../pipelines/rocketrideClient';

export class SessionCompactor {
  private sessionsDir: string;
  private rocketride?: RocketRideClient;

  constructor(workspaceRoot: string, _compactionThreshold: number = 1, rocketride?: RocketRideClient) {
    this.sessionsDir = path.join(workspaceRoot, '.rewind', 'sessions');
    this.rocketride = rocketride;
  }

  /** Always compact when there are sessions. */
  shouldCompact(): boolean {
    return this.getAllSessions().length > 0;
  }

  /** Run compaction. Returns the path to _current_summary.md, or null. */
  async compact(): Promise<string | null> {
    const sessions = this.getAllSessions();
    if (sessions.length === 0) { return null; }

    const lines: string[] = [];
    const allDecisions: Array<{ content: string; rationale: string; session: string }> = [];
    const allFileChanges: Array<{ path: string; type: string; diff?: string; session: string }> = [];
    const allInsights: string[] = [];
    const allErrors: string[] = [];
    const sessionSummaries: string[] = [];

    for (const filename of sessions) {
      const filePath = path.join(this.sessionsDir, filename);
      let content: string;
      try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
      const sectionLines = content.split('\n');

      const titleLine = sectionLines.find(l => l.startsWith('# Session:'));
      const title = titleLine?.replace('# Session: ', '') || filename;

      // Extract prompt
      const promptStart = sectionLines.findIndex(l => l.startsWith('## User Prompt'));
      let prompt = '';
      if (promptStart >= 0) {
        const codeStart = sectionLines.indexOf('```', promptStart);
        const codeEnd = sectionLines.indexOf('```', codeStart + 1);
        if (codeStart >= 0 && codeEnd > codeStart) {
          prompt = sectionLines.slice(codeStart + 1, codeEnd).join('\n');
        }
      }
      sessionSummaries.push(`- **${title}**: "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`);

      // Extract decisions
      const decisionsStart = sectionLines.findIndex(l => l.startsWith('## Decisions'));
      if (decisionsStart >= 0) {
        const decisionsEnd = sectionLines.findIndex((l, i) => i > decisionsStart && l.startsWith('## '));
        const decisionLines = sectionLines.slice(decisionsStart + 1, decisionsEnd > 0 ? decisionsEnd : decisionsStart + 20);
        for (const line of decisionLines) {
          const match = line.match(/- \*\*Decision:\*\*\s*(.+)/);
          if (match) { allDecisions.push({ content: match[1], rationale: '', session: title }); }
        }
      }

      // Extract file changes
      const changesStart = sectionLines.findIndex(l => l.startsWith('## Key File Changes'));
      if (changesStart >= 0) {
        const changesEnd = sectionLines.findIndex((l, i) => i > changesStart && l.startsWith('## '));
        const changeBlock = sectionLines.slice(changesStart, changesEnd > 0 ? changesEnd : changesStart + 30);

        let inDiff = false;
        let currentDiff: string[] = [];
        let currentFile = '';

        for (const line of changeBlock) {
          const fileMatch = line.match(/### (.+?) \((\w+)\)/);
          if (fileMatch) {
            if (currentDiff.length > 0 && currentFile) {
              const existing = allFileChanges.find(f => f.path === currentFile);
              if (existing) { existing.diff = currentDiff.join('\n'); }
            }
            currentFile = fileMatch[1];
            currentDiff = [];
            allFileChanges.push({ path: fileMatch[1], type: fileMatch[2], session: title });
          }
          if (line === '```diff') { inDiff = true; continue; }
          if (line === '```' && inDiff) { inDiff = false; continue; }
          if (inDiff) { currentDiff.push(line); }
        }
        if (currentDiff.length > 0 && currentFile) {
          const existing = allFileChanges.find(f => f.path === currentFile);
          if (existing) { existing.diff = currentDiff.join('\n'); }
        }
      }

      // Extract insights
      const insightsStart = sectionLines.findIndex(l => l.startsWith('## Key Insights'));
      if (insightsStart >= 0) {
        const insightsEnd = sectionLines.findIndex((l, i) => i > insightsStart && l.startsWith('## '));
        const insightLines = sectionLines.slice(insightsStart + 1, insightsEnd > 0 ? insightsEnd : insightsStart + 10);
        for (const line of insightLines) {
          if (line.startsWith('- ')) { allInsights.push(line.replace('- ', '')); }
        }
      }

      // Extract errors
      const errorsStart = sectionLines.findIndex(l => l.startsWith('## Errors'));
      if (errorsStart >= 0) {
        const errorsEnd = sectionLines.findIndex((l, i) => i > errorsStart && l.startsWith('## '));
        const errorLines = sectionLines.slice(errorsStart + 1, errorsEnd > 0 ? errorsEnd : errorsStart + 10);
        for (const line of errorLines) {
          if (line.startsWith('- ')) { allErrors.push(line.replace('- ', '')); }
        }
      }
    }

    // ── Build the rolling summary ──

    lines.push('# Compacted Session Summary');
    lines.push(`**Last Updated:** ${new Date().toISOString()}`);
    lines.push(`**Sessions:** ${sessions.length}`);
    lines.push('');

    lines.push('## Sessions Covered');
    for (const s of sessionSummaries) { lines.push(s); }
    lines.push('');

    if (allDecisions.length > 0) {
      lines.push('## All Decisions');
      const seen = new Set<string>();
      for (const d of allDecisions) {
        const key = d.content.toLowerCase().slice(0, 50);
        if (seen.has(key)) { continue; }
        seen.add(key);
        lines.push(`- **${d.content}** _(${d.session})_`);
      }
      lines.push('');
    }

    if (allFileChanges.length > 0) {
      lines.push('## Files Changed');
      const fileMap = new Map<string, typeof allFileChanges[0]>();
      for (const fc of allFileChanges) { fileMap.set(fc.path, fc); }
      for (const [, fc] of fileMap) {
        lines.push(`### ${fc.path} (${fc.type})`);
        if (fc.diff) {
          lines.push('```diff');
          const diffLines = fc.diff.split('\n');
          lines.push(diffLines.slice(0, 15).join('\n'));
          if (diffLines.length > 15) { lines.push(`... (${diffLines.length - 15} more lines)`); }
          lines.push('```');
        }
      }
      lines.push('');
    }

    if (allInsights.length > 0) {
      lines.push('## Key Insights');
      const uniqueInsights = [...new Set(allInsights)];
      for (const insight of uniqueInsights.slice(0, 10)) { lines.push(`- ${insight}`); }
      lines.push('');
    }

    if (allErrors.length > 0) {
      lines.push('## Errors Encountered');
      for (const err of allErrors.slice(0, 5)) { lines.push(`- ${err}`); }
      lines.push('');
    }

    // Try RocketRide LLM compression for a denser summary
    if (this.rocketride?.isConnected()) {
      try {
        const compressed = await this.rocketride.compressContext(
          sessionSummaries.map((s, i) => ({
            title: s.replace(/^- \*\*(.+?)\*\*.*/, '$1'),
            summary: s,
            decisions: allDecisions.filter(d => d.session === s).map(d => d.content),
            filesChanged: allFileChanges.filter(f => f.session === s).map(f => f.path),
          }))
        );
        if (compressed) {
          console.log('RewindAI: RocketRide compressed context successfully');
          lines.push('');
          lines.push('## AI-Compressed Summary');
          lines.push(compressed.summary);
          if (compressed.openIssues.length > 0) {
            lines.push('');
            lines.push('### Open Issues');
            for (const issue of compressed.openIssues) { lines.push(`- ${issue}`); }
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log('RewindAI: RocketRide compression skipped:', msg);
      }
    }

    // Write to the single rolling summary file
    const summaryPath = path.join(this.sessionsDir, '_current_summary.md');
    fs.writeFileSync(summaryPath, lines.join('\n'), 'utf-8');

    return summaryPath;
  }

  /** Read the latest rolling summary. */
  getLatestSummary(): string {
    const summaryPath = path.join(this.sessionsDir, '_current_summary.md');
    if (fs.existsSync(summaryPath)) {
      return fs.readFileSync(summaryPath, 'utf-8');
    }
    return '';
  }

  /** Get ALL session .md files (excluding _current_summary.md). */
  private getAllSessions(): string[] {
    if (!fs.existsSync(this.sessionsDir)) { return []; }
    return fs.readdirSync(this.sessionsDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .sort();
  }
}
