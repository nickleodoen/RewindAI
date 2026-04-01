/**
 * RocketRide Pipeline Client — Calls RocketRide AI pipelines for:
 * 1. Session Note Enrichment — LLM extracts decisions/insights (replaces regex)
 * 2. Context Compression — LLM produces dense summaries (replaces text parsing)
 * 3. Commit Relevance Scoring — LLM ranks commits for /suggest
 *
 * RocketRide runs as a Docker container on port 5565.
 * If unavailable, all functions return null and callers fall back to existing code.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface EnrichedSessionData {
  decisions: Array<{ content: string; rationale: string; confidence: number }>;
  insights: string[];
  summary: string;
  openQuestions: string[];
  keyCodeChanges: Array<{ file: string; description: string; importance: 'high' | 'medium' | 'low' }>;
}

export interface CompressedContext {
  summary: string;
  keyDecisions: string[];
  activeFiles: string[];
  openIssues: string[];
}

export interface CommitRelevanceResult {
  sha: string;
  relevanceScore: number;
  matchReason: string;
}

export class RocketRideClient {
  private baseUrl: string;
  private connected = false;
  private pipelinesDir: string;

  constructor(workspaceRoot: string, baseUrl: string = 'http://localhost:5565') {
    this.baseUrl = baseUrl;
    this.pipelinesDir = path.join(workspaceRoot, '.rewind', 'pipelines');
    this.ensurePipelines();
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      this.connected = res.ok;
      if (this.connected) { console.log('RewindAI: RocketRide connected'); }
      return this.connected;
    } catch {
      console.log('RewindAI: RocketRide not available — using local fallbacks');
      this.connected = false;
      return false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * PIPELINE 1: Enrich a session note using LLM analysis.
   * Instead of regex to extract decisions, sends conversation to RocketRide
   * which runs it through an LLM pipeline for structured extraction.
   */
  async enrichSessionNote(
    userPrompt: string,
    assistantResponse: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolCalls: Array<{ name: string; input: any; result: string }>,
  ): Promise<EnrichedSessionData | null> {
    if (!this.connected) { return null; }

    try {
      const input = {
        prompt: userPrompt,
        response: assistantResponse.slice(0, 3000),
        toolCalls: toolCalls.slice(0, 10).map(tc => ({
          tool: tc.name,
          input: JSON.stringify(tc.input).slice(0, 200),
          result: tc.result.slice(0, 300),
        })),
      };

      const result = await this.runPipeline('session-enrichment', JSON.stringify(input));
      if (result) {
        try { return JSON.parse(result); } catch { return null; }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('RewindAI: RocketRide enrichment failed:', msg);
    }
    return null;
  }

  /**
   * PIPELINE 2: Compress multiple session notes into a dense summary.
   * Replaces text-parsing compactor with LLM-powered compression.
   */
  async compressContext(
    sessions: Array<{ title: string; summary: string; decisions: string[]; filesChanged: string[] }>,
  ): Promise<CompressedContext | null> {
    if (!this.connected) { return null; }

    try {
      const input = JSON.stringify({ sessions: sessions.slice(0, 20) });
      const result = await this.runPipeline('context-compression', input);
      if (result) {
        try { return JSON.parse(result); } catch { return null; }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('RewindAI: RocketRide compression failed:', msg);
    }
    return null;
  }

  /**
   * PIPELINE 3: Score commits for relevance to a user query.
   * Uses LLM to understand INTENT behind the query and match to commits.
   */
  async scoreCommitRelevance(
    query: string,
    commits: Array<{ sha: string; message: string; summary: string; decisions: string[] }>,
  ): Promise<CommitRelevanceResult[] | null> {
    if (!this.connected) { return null; }

    try {
      const input = JSON.stringify({
        query,
        commits: commits.slice(0, 15).map(c => ({
          sha: c.sha,
          message: c.message,
          summary: c.summary?.slice(0, 200) || '',
          decisions: c.decisions?.slice(0, 5) || [],
        })),
      });

      const result = await this.runPipeline('commit-relevance', input);
      if (result) {
        try { return JSON.parse(result); } catch { return null; }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('RewindAI: RocketRide relevance scoring failed:', msg);
    }
    return null;
  }

  private async runPipeline(pipelineName: string, input: string): Promise<string | null> {
    try {
      const pipeFilePath = path.join(this.pipelinesDir, `${pipelineName}.pipe`);

      const res = await fetch(`${this.baseUrl}/api/v1/pipelines/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline: pipeFilePath, input }),
        signal: AbortSignal.timeout(30000),
      });

      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await res.json();
        return typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
      }
    } catch {
      // RocketRide call failed
    }

    return null;
  }

  private ensurePipelines(): void {
    if (!fs.existsSync(this.pipelinesDir)) {
      fs.mkdirSync(this.pipelinesDir, { recursive: true });
    }

    this.writePipelineIfMissing('session-enrichment.pipe', {
      name: 'RewindAI Session Enrichment',
      description: 'Extract decisions, insights, and structured data from a coding session',
      nodes: [
        { id: 'source', type: 'webhook', config: { method: 'POST' } },
        {
          id: 'llm_extract', type: 'llm',
          config: {
            provider: 'anthropic', model: 'claude-sonnet-4-6',
            systemPrompt: `You are analyzing a coding session. Extract structured data.
Return ONLY valid JSON: {"decisions":[{"content":"...","rationale":"...","confidence":0.9}],"insights":["..."],"summary":"2-3 sentences","openQuestions":["..."],"keyCodeChanges":[{"file":"path","description":"...","importance":"high"}]}`,
            temperature: 0.1,
          },
          inputs: ['source'],
        },
        { id: 'output', type: 'output', inputs: ['llm_extract'] },
      ],
    });

    this.writePipelineIfMissing('context-compression.pipe', {
      name: 'RewindAI Context Compression',
      description: 'Compress multiple session notes into a dense summary',
      nodes: [
        { id: 'source', type: 'webhook', config: { method: 'POST' } },
        {
          id: 'llm_compress', type: 'llm',
          config: {
            provider: 'anthropic', model: 'claude-sonnet-4-6',
            systemPrompt: `Compress coding session notes into a dense summary. Keep decisions, key changes, unresolved issues. Drop verbose outputs.
Return ONLY valid JSON: {"summary":"dense paragraph","keyDecisions":["..."],"activeFiles":["..."],"openIssues":["..."]}`,
            temperature: 0.1,
          },
          inputs: ['source'],
        },
        { id: 'output', type: 'output', inputs: ['llm_compress'] },
      ],
    });

    this.writePipelineIfMissing('commit-relevance.pipe', {
      name: 'RewindAI Commit Relevance',
      description: 'Score commits by relevance to a user query',
      nodes: [
        { id: 'source', type: 'webhook', config: { method: 'POST' } },
        {
          id: 'llm_score', type: 'llm',
          config: {
            provider: 'anthropic', model: 'claude-sonnet-4-6',
            systemPrompt: `Score each commit's relevance to the user query. Understand intent.
Return ONLY a JSON array: [{"sha":"abc1234","relevanceScore":0.95,"matchReason":"explanation"}] sorted by score desc, only score > 0.3.`,
            temperature: 0.1,
          },
          inputs: ['source'],
        },
        { id: 'output', type: 'output', inputs: ['llm_score'] },
      ],
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private writePipelineIfMissing(filename: string, content: any): void {
    const filePath = path.join(this.pipelinesDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    }
  }
}
