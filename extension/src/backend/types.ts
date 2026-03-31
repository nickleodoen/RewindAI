/** Shared types between extension and backend.
 *  Field names match the JSON returned by the FastAPI backend (snake_case).
 */

export interface CommitSnapshot {
  sha: string;
  branch: string;
  timestamp: string;
  summary: string;
  token_count: number;
  commit_message: string;
}

export interface Decision {
  content: string;
  rationale: string;
}

export interface CreateSnapshotRequest {
  sha: string;
  branch: string;
  commit_message: string;
  messages: Array<{ role: string; content: string }>;
}

export interface RestoreResponse {
  snapshot: CommitSnapshot;
  summary: string;
  decisions: Decision[];
  files_discussed: string[];
  compressed_context: string;
}

export interface HealthResponse {
  status: string;
  neo4j: string;
  version: string;
}

export interface SnapshotListItem {
  sha: string;
  branch: string;
  timestamp: string;
  summary: string;
  commit_message: string;
}

export interface DecisionChainEntry {
  sha: string;
  summary: string;
  decision: string;
  rationale: string;
  timestamp: string;
}
