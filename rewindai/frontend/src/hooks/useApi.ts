import { useState, useCallback } from 'react'
import type {
  Session, Message, ChatResponse, Branch, Commit, Memory,
  DiffResult, GraphData, TimelineEntry,
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

export function useApi() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wrap = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await fn()
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // Sessions
  const createSession = (branch_name: string, user_id: string) =>
    wrap(() => apiFetch<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ branch_name, user_id }),
    }))

  const listSessions = () => wrap(() => apiFetch<Session[]>('/sessions'))

  const getMessages = (sessionId: string) =>
    wrap(() => apiFetch<Message[]>(`/sessions/${sessionId}/messages`))

  // Chat
  const sendMessage = (session_id: string, message: string, user_id: string) =>
    wrap(() => apiFetch<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify({ session_id, message, user_id }),
    }))

  // Branches
  const createBranch = (branch_name: string, source_commit_id?: string, user_id?: string) =>
    wrap(() => apiFetch<Branch>('/branches', {
      method: 'POST',
      body: JSON.stringify({ branch_name, source_commit_id, user_id }),
    }))

  const listBranches = () => wrap(() => apiFetch<Branch[]>('/branches'))

  const checkoutBranch = (branch_name: string, commit_id?: string, user_id?: string) =>
    wrap(() => apiFetch<{ session_id: string; branch_name: string; commit_id: string }>('/branches/checkout', {
      method: 'POST',
      body: JSON.stringify({ branch_name, commit_id, user_id }),
    }))

  // Commits
  const createCommit = (branch_name: string, message: string, user_id?: string) =>
    wrap(() => apiFetch<Commit>('/commits', {
      method: 'POST',
      body: JSON.stringify({ branch_name, message, user_id }),
    }))

  const listCommits = (branch_name: string) =>
    wrap(() => apiFetch<Commit[]>(`/commits?branch_name=${branch_name}`))

  // Memories
  const listMemories = (branch_name: string) =>
    wrap(() => apiFetch<Memory[]>(`/memories?branch_name=${branch_name}`))

  // Diff
  const diffBranches = (branch_a: string, branch_b: string) =>
    wrap(() => apiFetch<DiffResult>('/diff', {
      method: 'POST',
      body: JSON.stringify({ branch_a, branch_b }),
    }))

  // Graph
  const getGraphNeighborhood = (nodeId: string) =>
    wrap(() => apiFetch<GraphData>(`/graph/neighborhood/${nodeId}`))

  // Timeline
  const getTimeline = (branch_name: string) =>
    wrap(() => apiFetch<TimelineEntry[]>(`/timeline/${branch_name}`))

  return {
    loading, error,
    createSession, listSessions, getMessages,
    sendMessage,
    createBranch, listBranches, checkoutBranch,
    createCommit, listCommits,
    listMemories,
    diffBranches,
    getGraphNeighborhood,
    getTimeline,
  }
}
