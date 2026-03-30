export type MemoryType = 'decision' | 'fact' | 'context' | 'action_item' | 'question'

export interface Session {
  id: string
  branch_name: string
  user_id: string
  created_at?: string
}

export interface Message {
  id: string
  role: string
  content: string
  created_at?: string
}

export interface ChatResponse {
  session_id: string
  response: string
  compaction_occurred: boolean
  memories_extracted: number
  response_mode: 'live' | 'fallback' | 'mock'
  notice?: string | null
}

export interface Branch {
  name: string
  created_at?: string
  created_by?: string
  head_commit_id?: string | null
  head_message?: string | null
  branched_from_commit_id?: string | null
}

export interface Commit {
  id: string
  message: string
  branch_name: string
  user_id?: string
  created_at?: string
  summary?: string | null
  memory_delta_count?: number
  parent_id?: string | null
  parent_ids?: string[]
  is_merge?: boolean
  merge_strategy?: string | null
  merged_from_branch?: string | null
  merge_base_commit_id?: string | null
  conflicts_resolved?: number
}

export interface Memory {
  id: string
  type: MemoryType | string
  content: string
  branch_name: string
  tags: string[]
  user_id?: string
  created_at?: string
}

export interface DiffResult {
  branch_a: string
  branch_b: string
  only_a: Memory[]
  only_b: Memory[]
}

export interface GraphNode {
  id: string
  label: string
  type?: string | null
  properties: Record<string, unknown>
}

export interface GraphEdge {
  source: string
  target: string
  relationship: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface TimelineEntry {
  commit: Commit
  parent_id?: string | null
}

export interface CommitSnapshot {
  commit: Commit
  branch_name: string
  parent_ids: string[]
  is_merge: boolean
  merged_from_branch?: string | null
  merge_base_commit_id?: string | null
  active_memories: Memory[]
  active_memory_count: number
  memory_breakdown: Record<string, number>
  grouped_memories: Record<string, Memory[]>
  context_summary: string
  reconstructed_context?: string | null
  compaction_snapshot_count: number
}

export interface MergeConflict {
  memory_a: Memory
  memory_b: Memory
  reason: string
}

export interface MergePreview {
  target_branch: string
  source_branch: string
  target_head_commit_id?: string | null
  source_head_commit_id?: string | null
  merge_base_commit_id?: string | null
  mode: 'up_to_date' | 'fast_forward' | 'merge_required'
  conflicts: MergeConflict[]
  auto_merged: Memory[]
  stats: Record<string, number>
}

export interface WorkspaceStatus {
  user_id: string
  mode: 'attached' | 'detached' | 'uninitialized'
  branch_name?: string | null
  head_commit_id?: string | null
  head_message?: string | null
  head_summary?: string | null
  head_parent_ids?: string[]
  head_is_merge?: boolean
  session_id?: string | null
  origin_branch?: string | null
  origin_commit_id?: string | null
  reconstructed_at?: string | null
  active_memory_count: number
  memory_breakdown: Record<string, number>
  summary: string
}

export interface HealthResponse {
  status: string
  neo4j: string
}
