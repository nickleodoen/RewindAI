/**
 * CommitSuggester — Recommends which commit to checkout based on what the user describes.
 *
 * When the user says something like "go back to when we had simple auth" or
 * "I want the version before we added the dashboard", this module searches
 * through all commit snapshots and session notes to find the best match.
 *
 * Ranks commits by relevance using:
 * 1. Keyword overlap with commit messages
 * 2. Keyword overlap with snapshot summaries
 * 3. Keyword overlap with decisions
 * 4. File overlap (if the user mentions specific files)
 * 5. Session note content
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { Neo4jGraphClient } from '../graph/neo4jClient';

export interface CommitSuggestion {
  sha: string;
  message: string;
  branch: string;
  timestamp: string;
  score: number;
  matchReasons: string[];
  summary?: string;
  decisions?: string[];
}

export class CommitSuggester {
  private workspaceRoot: string;
  private snapshotsDir: string;
  private sessionsDir: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private neo4j?: Neo4jGraphClient;

  constructor(workspaceRoot: string, neo4j?: Neo4jGraphClient) {
    this.workspaceRoot = workspaceRoot;
    this.neo4j = neo4j;
    this.snapshotsDir = path.join(workspaceRoot, '.rewind', 'snapshots');
    this.sessionsDir = path.join(workspaceRoot, '.rewind', 'sessions');
  }

  /**
   * Find the best commits to suggest based on a natural language query.
   * Returns up to 3 suggestions, ranked by relevance.
   */
  async suggest(query: string): Promise<CommitSuggestion[]> {
    // TRY NEO4J FIRST — graph queries are faster and more powerful
    if (this.neo4j?.isConnected()) {
      try {
        const keywords = [...this.extractKeywords(query.toLowerCase())];
        if (keywords.length > 0) {
          const results = await this.neo4j.findRelevantCommits(keywords);
          if (results.length > 0) {
            console.log('RewindAI: CommitSuggester using Neo4j graph query');
            return results.map(r => ({
              sha: r.sha,
              message: r.message,
              branch: 'main',
              timestamp: '',
              score: r.score,
              matchReasons: r.matchedDecisions.map(d => `Decision: "${d.slice(0, 60)}"`),
              summary: r.summary,
              decisions: r.matchedDecisions,
            }));
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log('RewindAI: Neo4j query failed, falling back to file scan:', msg);
      }
    }

    // FALLBACK: file-scanning logic
    const commits = await this.getGitLog();
    const snapshots = this.loadAllSnapshots();
    const scored: CommitSuggestion[] = [];

    const queryLower = query.toLowerCase();
    const queryWords = this.extractKeywords(queryLower);

    for (const commit of commits) {
      let score = 0;
      const reasons: string[] = [];

      // Score 1: Commit message relevance
      const msgLower = commit.message.toLowerCase();
      const msgOverlap = this.wordOverlap(queryWords, this.extractKeywords(msgLower));
      if (msgOverlap > 0) {
        score += msgOverlap * 3;
        reasons.push(`Commit message matches: "${commit.message.slice(0, 60)}"`);
      }

      // Score 2: Snapshot summary relevance
      const snapshot = snapshots.get(commit.sha);
      if (snapshot) {
        const summaryLower = (snapshot.context?.summary || '').toLowerCase();
        const summaryOverlap = this.wordOverlap(queryWords, this.extractKeywords(summaryLower));
        if (summaryOverlap > 0) {
          score += summaryOverlap * 4;
          reasons.push('Context summary matches');
        }

        // Score 3: Decision relevance
        for (const decision of (snapshot.context?.decisions || [])) {
          const decLower = decision.content.toLowerCase();
          const decOverlap = this.wordOverlap(queryWords, this.extractKeywords(decLower));
          if (decOverlap > 0) {
            score += decOverlap * 5;
            reasons.push(`Decision: "${decision.content.slice(0, 60)}"`);
          }
        }

        // Score 4: Files discussed relevance
        for (const file of (snapshot.context?.filesDiscussed || [])) {
          if (queryLower.includes(file.toLowerCase()) || queryLower.includes(path.basename(file).toLowerCase())) {
            score += 3;
            reasons.push(`Discussed file: ${file}`);
          }
        }

        // Score 5: Scratchpad notes
        for (const note of (snapshot.context?.scratchpad || [])) {
          const noteOverlap = this.wordOverlap(queryWords, this.extractKeywords(note.toLowerCase()));
          if (noteOverlap > 0) {
            score += noteOverlap * 2;
          }
        }
      }

      // Score 6: Session files for this commit
      const sessionScore = this.scoreSessionFiles(queryWords, snapshot);
      if (sessionScore.score > 0) {
        score += sessionScore.score;
        reasons.push(...sessionScore.reasons);
      }

      // Bonus for "before"/"without" queries — slight preference for older commits
      if (queryLower.includes('before') || queryLower.includes('without') || queryLower.includes('back to')) {
        const age = commits.indexOf(commit);
        score += Math.min(age * 0.5, 3);
      }

      if (score > 0) {
        scored.push({
          sha: commit.sha,
          message: commit.message,
          branch: commit.branch || 'main',
          timestamp: commit.timestamp || '',
          score,
          matchReasons: reasons,
          summary: snapshot?.context?.summary,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          decisions: snapshot?.context?.decisions?.map((d: any) => d.content),
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3);
  }

  private getGitLog(): Promise<Array<{ sha: string; message: string; branch?: string; timestamp?: string }>> {
    return new Promise((resolve) => {
      exec(
        'git log --all --format="%H|%s|%D|%aI" --max-count=50',
        { cwd: this.workspaceRoot, timeout: 10000 },
        (error, stdout) => {
          if (error || !stdout) {
            resolve([]);
            return;
          }
          const commits = stdout.trim().split('\n').map(line => {
            const [sha, message, refs, timestamp] = line.split('|');
            const branch = refs?.match(/HEAD -> (\S+)/)?.[1] || refs?.match(/(\S+)/)?.[1] || '';
            return { sha: sha?.trim(), message: message?.trim(), branch: branch?.trim(), timestamp: timestamp?.trim() };
          }).filter(c => c.sha && c.message);
          resolve(commits);
        },
      );
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private loadAllSnapshots(): Map<string, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshots = new Map<string, any>();
    if (!fs.existsSync(this.snapshotsDir)) { return snapshots; }

    for (const file of fs.readdirSync(this.snapshotsDir)) {
      if (!file.endsWith('.json')) { continue; }
      try {
        const raw = fs.readFileSync(path.join(this.snapshotsDir, file), 'utf-8');
        const snapshot = JSON.parse(raw);
        if (snapshot.commitSha) {
          snapshots.set(snapshot.commitSha, snapshot);
        }
      } catch {
        // Skip corrupted files
      }
    }

    return snapshots;
  }

  private scoreSessionFiles(
    queryWords: Set<string>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshot: any,
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    if (!snapshot?.sessionFiles || !fs.existsSync(this.sessionsDir)) {
      return { score, reasons };
    }

    for (const sessionFile of (snapshot.sessionFiles || []).slice(0, 5)) {
      const filePath = path.join(this.sessionsDir, sessionFile);
      if (!fs.existsSync(filePath)) { continue; }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const contentWords = this.extractKeywords(content.toLowerCase().slice(0, 2000));
        const overlap = this.wordOverlap(queryWords, contentWords);
        if (overlap > 0) {
          score += overlap * 2;
          const titleMatch = content.match(/# Session: (.+)/);
          if (titleMatch) {
            reasons.push(`Session: "${titleMatch[1].slice(0, 50)}"`);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return { score, reasons };
  }

  private extractKeywords(text: string): Set<string> {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'shall', 'can', 'may', 'might', 'must',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'they', 'them',
      'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
      'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'how', 'why',
      'not', 'no', 'nor', 'so', 'too', 'very', 'just', 'about', 'also',
      'for', 'from', 'in', 'on', 'at', 'to', 'of', 'with', 'by', 'as',
      'go', 'back', 'want', 'like', 'need', 'get', 'make', 'use', 'had',
    ]);

    const words = text.split(/[^a-z0-9]+/).filter(w => w.length > 2 && !stopWords.has(w));
    return new Set(words);
  }

  private wordOverlap(setA: Set<string>, setB: Set<string>): number {
    let count = 0;
    for (const word of setA) {
      if (setB.has(word)) { count++; }
    }
    return count;
  }
}
