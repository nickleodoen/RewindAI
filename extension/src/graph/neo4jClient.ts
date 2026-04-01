/**
 * Neo4j Graph Client — Direct connection from VS Code extension to Neo4j.
 *
 * Every session note, decision, file change, and commit becomes a node in the graph.
 * Relationships connect them: decisions DEPEND_ON other decisions, files are DISCUSSED_IN
 * sessions, sessions BELONG_TO commits, commits are PARENT_OF other commits.
 *
 * This enables queries that flat files CANNOT do:
 * - "What chain of decisions led to the current JWT implementation?"
 * - "Which commits discussed auth.ts and what was decided each time?"
 * - "Find the commit where we switched from REST to GraphQL"
 *
 * If Neo4j is unavailable, all methods silently return empty results.
 */

import neo4j, { Driver, Session as Neo4jSession } from 'neo4j-driver';

export class Neo4jGraphClient {
  private driver: Driver | null = null;
  private connected = false;

  constructor() {}

  /**
   * Connect to Neo4j. Silently fails if Neo4j isn't running — the extension
   * works without it, just without graph query capabilities.
   */
  async connect(
    uri: string = 'bolt://localhost:7687',
    username: string = 'neo4j',
    password: string = 'password',
  ): Promise<boolean> {
    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
      await this.driver.verifyConnectivity();
      this.connected = true;
      console.log('RewindAI: Neo4j connected');
      await this.initSchema();
      return true;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`RewindAI: Neo4j not available (${msg}) — using file-based fallback`);
      this.driver = null;
      this.connected = false;
      return false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async initSchema(): Promise<void> {
    const queries = [
      'CREATE CONSTRAINT commit_sha IF NOT EXISTS FOR (c:Commit) REQUIRE c.sha IS UNIQUE',
      'CREATE CONSTRAINT session_id IF NOT EXISTS FOR (s:SessionNote) REQUIRE s.id IS UNIQUE',
      'CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE',
      'CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:FileNode) REQUIRE f.path IS UNIQUE',
      'CREATE INDEX commit_branch IF NOT EXISTS FOR (c:Commit) ON (c.branch)',
      'CREATE INDEX commit_timestamp IF NOT EXISTS FOR (c:Commit) ON (c.timestamp)',
      'CREATE INDEX session_timestamp IF NOT EXISTS FOR (s:SessionNote) ON (s.timestamp)',
    ];

    for (const query of queries) {
      await this.run(query).catch(() => {}); // Ignore if already exists
    }
  }

  // ── WRITE OPERATIONS ──

  async indexCommit(
    sha: string,
    message: string,
    branch: string,
    timestamp: string,
    parentSha?: string,
    author?: string,
  ): Promise<void> {
    if (!this.connected) { return; }

    await this.run(
      `MERGE (c:Commit {sha: $sha})
       SET c.message = $message, c.branch = $branch, c.timestamp = datetime($timestamp)
       MERGE (b:Branch {name: $branch})
       MERGE (c)-[:ON_BRANCH]->(b)`,
      { sha, message, branch, timestamp },
    );

    if (parentSha) {
      await this.run(
        `MATCH (c:Commit {sha: $sha})
         MATCH (p:Commit {sha: $parentSha})
         MERGE (c)-[:PARENT_OF]->(p)`,
        { sha, parentSha },
      );
    }

    if (author) {
      await this.run(
        `MATCH (c:Commit {sha: $sha})
         MERGE (a:Author {name: $author})
         MERGE (c)-[:AUTHORED_BY]->(a)`,
        { sha, author },
      );
    }
  }

  async indexSession(
    sessionId: string,
    commitSha: string,
    title: string,
    timestamp: string,
    userPrompt: string,
    summary: string,
    decisions: Array<{ content: string; rationale: string }>,
    filesModified: string[],
    filesRead: string[],
  ): Promise<void> {
    if (!this.connected) { return; }

    await this.run(
      `MERGE (s:SessionNote {id: $id})
       SET s.title = $title, s.timestamp = datetime($timestamp),
           s.prompt = $prompt, s.summary = $summary
       WITH s
       MATCH (c:Commit {sha: $commitSha})
       MERGE (s)-[:BELONGS_TO]->(c)`,
      { id: sessionId, title, timestamp, prompt: userPrompt.slice(0, 500), summary: summary.slice(0, 1000), commitSha },
    );

    for (let i = 0; i < decisions.length; i++) {
      const d = decisions[i];
      const decisionId = `${sessionId}_dec_${i}`;
      await this.run(
        `MERGE (d:Decision {id: $id})
         SET d.content = $content, d.rationale = $rationale
         WITH d
         MATCH (s:SessionNote {id: $sessionId})
         MERGE (d)-[:MADE_IN]->(s)`,
        { id: decisionId, content: d.content, rationale: d.rationale, sessionId },
      );
    }

    for (const filePath of [...filesModified, ...filesRead]) {
      await this.run(
        `MERGE (f:FileNode {path: $path})
         WITH f
         MATCH (s:SessionNote {id: $sessionId})
         MERGE (s)-[:DISCUSSED]->(f)`,
        { path: filePath, sessionId },
      );

      if (filesModified.includes(filePath)) {
        await this.run(
          `MATCH (f:FileNode {path: $path})
           MATCH (c:Commit {sha: $sha})
           MERGE (f)-[:MODIFIED_IN]->(c)`,
          { path: filePath, sha: commitSha },
        );
      }
    }
  }

  async linkDecisions(decisionIdA: string, decisionIdB: string): Promise<void> {
    if (!this.connected) { return; }
    await this.run(
      `MATCH (a:Decision {id: $idA})
       MATCH (b:Decision {id: $idB})
       MERGE (b)-[:DEPENDS_ON]->(a)`,
      { idA: decisionIdA, idB: decisionIdB },
    );
  }

  // ── READ OPERATIONS ──

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async findCommitsForFile(filePath: string): Promise<Array<{ sha: string; message: string; decisions: string[]; summary: string }>> {
    if (!this.connected) { return []; }

    const result = await this.run(
      `MATCH (f:FileNode {path: $path})<-[:DISCUSSED]-(s:SessionNote)-[:BELONGS_TO]->(c:Commit)
       OPTIONAL MATCH (d:Decision)-[:MADE_IN]->(s)
       RETURN c.sha AS sha, c.message AS message, s.summary AS summary,
              collect(DISTINCT d.content) AS decisions
       ORDER BY c.timestamp DESC
       LIMIT 10`,
      { path: filePath },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.map((r: any) => ({
      sha: r.sha,
      message: r.message,
      decisions: r.decisions.filter(Boolean),
      summary: r.summary || '',
    }));
  }

  async findRelevantCommits(keywords: string[]): Promise<Array<{ sha: string; message: string; score: number; matchedDecisions: string[]; summary: string }>> {
    if (!this.connected) { return []; }

    const result = await this.run(
      `MATCH (c:Commit)
       OPTIONAL MATCH (s:SessionNote)-[:BELONGS_TO]->(c)
       OPTIONAL MATCH (d:Decision)-[:MADE_IN]->(s)
       WITH c, collect(DISTINCT s.summary) AS summaries, collect(DISTINCT d.content) AS decisions
       WITH c, summaries, decisions,
            reduce(score = 0, keyword IN $keywords |
              score
              + CASE WHEN toLower(c.message) CONTAINS toLower(keyword) THEN 3 ELSE 0 END
              + reduce(s = 0, summary IN summaries | s + CASE WHEN toLower(summary) CONTAINS toLower(keyword) THEN 4 ELSE 0 END)
              + reduce(d = 0, dec IN decisions | d + CASE WHEN toLower(dec) CONTAINS toLower(keyword) THEN 5 ELSE 0 END)
            ) AS score
       WHERE score > 0
       RETURN c.sha AS sha, c.message AS message, score,
              [d IN decisions WHERE any(k IN $keywords WHERE toLower(d) CONTAINS toLower(k))] AS matchedDecisions,
              summaries[0] AS summary
       ORDER BY score DESC
       LIMIT 5`,
      { keywords },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.map((r: any) => ({
      sha: r.sha,
      message: r.message,
      score: typeof r.score === 'object' ? r.score.toNumber?.() || 0 : Number(r.score),
      matchedDecisions: r.matchedDecisions || [],
      summary: r.summary || '',
    }));
  }

  async getDecisionChain(decisionContent: string): Promise<Array<{ content: string; rationale: string; commitSha: string; depth: number }>> {
    if (!this.connected) { return []; }

    const result = await this.run(
      `MATCH (d:Decision)
       WHERE toLower(d.content) CONTAINS toLower($content)
       MATCH path = (d)-[:DEPENDS_ON*0..5]->(root:Decision)
       MATCH (root)-[:MADE_IN]->(s:SessionNote)-[:BELONGS_TO]->(c:Commit)
       RETURN root.content AS content, root.rationale AS rationale,
              c.sha AS commitSha, length(path) AS depth
       ORDER BY depth ASC`,
      { content: decisionContent },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.map((r: any) => ({
      content: r.content,
      rationale: r.rationale || '',
      commitSha: r.commitSha,
      depth: typeof r.depth === 'object' ? r.depth.toNumber?.() || 0 : Number(r.depth),
    }));
  }

  async getStats(): Promise<{ commits: number; sessions: number; decisions: number; files: number }> {
    if (!this.connected) { return { commits: 0, sessions: 0, decisions: 0, files: 0 }; }

    try {
      const result = await this.run(
        `OPTIONAL MATCH (c:Commit) WITH count(c) AS commits
         OPTIONAL MATCH (s:SessionNote) WITH commits, count(s) AS sessions
         OPTIONAL MATCH (d:Decision) WITH commits, sessions, count(d) AS decisions
         OPTIONAL MATCH (f:FileNode) RETURN commits, sessions, decisions, count(f) AS files`,
      );

      if (result.length === 0) { return { commits: 0, sessions: 0, decisions: 0, files: 0 }; }
      const r = result[0];
      const toNum = (v: unknown): number => typeof v === 'object' && v !== null && 'toNumber' in v ? (v as { toNumber: () => number }).toNumber() : Number(v);
      return { commits: toNum(r.commits), sessions: toNum(r.sessions), decisions: toNum(r.decisions), files: toNum(r.files) };
    } catch {
      return { commits: 0, sessions: 0, decisions: 0, files: 0 };
    }
  }

  // ── Internal ──

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async run(query: string, params: Record<string, any> = {}): Promise<any[]> {
    if (!this.driver) { return []; }
    const session: Neo4jSession = this.driver.session();
    try {
      const result = await session.run(query, params);
      return result.records.map(r => r.toObject());
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      this.connected = false;
    }
  }
}
