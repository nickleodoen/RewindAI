import type {
  Session, Message, ChatResponse, Branch, Commit, Memory,
  DiffResult, GraphData, TimelineEntry, HealthResponse, WorkspaceStatus, MergePreview,
} from '../types'

const API = '/api/v1'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

function withQuery(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      search.set(key, value)
    }
  })

  return search.size > 0 ? `${path}?${search.toString()}` : path
}

export function useApi() {
  const getHealth = () =>
    fetch('/health').then(async res => {
      if (!res.ok) {
        throw new Error(`Health check failed: ${res.statusText}`)
      }

      return res.json() as Promise<HealthResponse>
    })

  // Sessions
  const createSession = (branch_name: string, user_id: string) =>
    apiFetch<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ branch_name, user_id }),
    })

  const listSessions = () => apiFetch<Session[]>('/sessions')

  const getMessages = (sessionId: string) =>
    apiFetch<Message[]>(`/sessions/${sessionId}/messages`)

  // Chat
  const sendMessage = (session_id: string, message: string, user_id: string) =>
    apiFetch<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify({ session_id, message, user_id }),
    })

  // Workspace
  const getWorkspaceStatus = (user_id = 'demo') =>
    apiFetch<WorkspaceStatus>(withQuery('/workspace/status', { user_id }))

  const workspaceCheckout = (ref: string, user_id = 'demo', reuse_session = false) =>
    apiFetch<{
      mode: 'attached' | 'detached'
      branch_name?: string | null
      commit_id?: string | null
      session_id?: string | null
      context_messages?: Array<{ role: string; content: string }>
      memory_count?: number
      status: WorkspaceStatus
    }>('/workspace/checkout', {
      method: 'POST',
      body: JSON.stringify({ ref, user_id, reuse_session }),
    })

  const workspaceAttachBranch = (branch_name: string, user_id = 'demo', reuse_session = false) =>
    apiFetch<{
      mode: 'attached'
      branch_name: string
      commit_id?: string | null
      session_id?: string | null
      status: WorkspaceStatus
    }>('/workspace/attach-branch', {
      method: 'POST',
      body: JSON.stringify({ branch_name, user_id, reuse_session }),
    })

  const workspaceCommit = (message: string, user_id = 'demo') =>
    apiFetch<Commit & { status: WorkspaceStatus }>('/workspace/commit', {
      method: 'POST',
      body: JSON.stringify({ message, user_id }),
    })

  const mergePreview = (source_branch: string, target_branch?: string, user_id = 'demo') =>
    apiFetch<MergePreview>(withQuery('/workspace/merge-preview', { source_branch, target_branch, user_id }))

  // Branches
  const createBranch = (branch_name: string, source_commit_id?: string, user_id = 'demo') =>
    apiFetch<Branch>('/branches', {
      method: 'POST',
      body: JSON.stringify({ branch_name, source_commit_id, user_id }),
    })

  const listBranches = () => apiFetch<Branch[]>('/branches')

  const checkoutBranch = (branch_name: string, commit_id?: string, user_id = 'demo') =>
    apiFetch<{
      session_id: string
      branch_name: string
      commit_id: string
      context_messages?: Array<{ role: string; content: string }>
      memory_count?: number
    }>('/branches/checkout', {
      method: 'POST',
      body: JSON.stringify({ branch_name, commit_id, user_id }),
    })

  // Commits
  const createCommit = (branch_name: string, message: string, user_id = 'demo') =>
    apiFetch<Commit>('/commits', {
      method: 'POST',
      body: JSON.stringify({ branch_name, message, user_id }),
    })

  const listCommits = (branch_name: string) =>
    apiFetch<Commit[]>(withQuery('/commits', { branch_name }))

  // Memories
  const listMemories = (branch_name: string) =>
    apiFetch<Memory[]>(withQuery('/memories', { branch_name }))

  // Diff
  const diffBranches = (branch_a: string, branch_b: string) =>
    apiFetch<DiffResult>('/diff', {
      method: 'POST',
      body: JSON.stringify({ branch_a, branch_b }),
    })

  // Graph
  const getGraphNeighborhood = (nodeId: string) =>
    apiFetch<GraphData>(`/graph/neighborhood/${nodeId}`)

  const getBranchGraph = (branch_name: string) =>
    apiFetch<GraphData>(`/graph/branch/${branch_name}`)

  // Timeline
  const getTimeline = (branch_name: string) =>
    apiFetch<TimelineEntry[]>(`/timeline/${branch_name}`)

  return {
    getHealth,
    createSession, listSessions, getMessages,
    sendMessage,
    getWorkspaceStatus, workspaceCheckout, workspaceAttachBranch, workspaceCommit, mergePreview,
    createBranch, listBranches, checkoutBranch,
    createCommit, listCommits,
    listMemories,
    diffBranches,
    getGraphNeighborhood,
    getBranchGraph,
    getTimeline,
  }
}
