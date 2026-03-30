export interface Session {
  id: string
  branch_name: string
  user_id: string
  created_at?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at?: string
}

export interface ChatResponse {
  session_id: string
  response: string
  compaction_occurred: boolean
  memories_extracted: number
}

export interface Branch {
  name: string
  created_at?: string
  created_by?: string
}

export interface Commit {
  id: string
  message: string
  branch_name: string
  user_id?: string
  created_at?: string
}

export interface Memory {
  id: string
  type: 'decision' | 'fact' | 'context' | 'action_item' | 'question'
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
  type?: string
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
  parent_id?: string
}
