import { useEffect, useState } from 'react'
import type { TimelineEntry, CommitSnapshot, Memory } from '../types'
import { useApi } from '../hooks/useApi'

interface Props {
  branchName: string
  refreshKey: number
  onCheckout: (commitId: string, commitMessage: string) => void
}

function formatTimestamp(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  decision: { label: 'Decisions', color: '#8b5cf6', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  fact: { label: 'Facts', color: '#3b82f6', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  action_item: { label: 'Action Items', color: '#f97316', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  question: { label: 'Open Questions', color: '#eab308', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  context: { label: 'Context', color: '#6366f1', icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z' },
}

function MemoryCard({ memory }: { memory: Memory }) {
  const config = TYPE_CONFIG[memory.type] || TYPE_CONFIG.context
  return (
    <div
      className="rounded-lg px-3 py-2 text-[11px] leading-relaxed text-text-secondary"
      style={{ background: 'rgba(255,255,255,0.03)', borderLeft: `2px solid ${config.color}` }}
    >
      {memory.content}
      {memory.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {memory.tags.map(tag => (
            <span key={tag} className="rounded px-1 py-px text-[9px] text-text-muted" style={{ background: 'rgba(255,255,255,0.06)' }}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function SnapshotInspector({
  snapshot,
  loading,
  error,
  onRewind,
}: {
  snapshot: CommitSnapshot | null
  loading: boolean
  error: string | null
  onRewind: () => void
}) {
  const [expandedType, setExpandedType] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-text-muted border-t-violet-400" />
        <span className="text-xs text-text-muted">Loading snapshot...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-lg px-3 py-2.5 text-xs text-red-300" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
          {error}
        </div>
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgba(139,92,246,0.08)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div className="text-xs text-text-muted leading-relaxed">
          Click a commit to inspect<br />the AI's memory at that point
        </div>
      </div>
    )
  }

  const { commit } = snapshot
  const typeOrder = ['decision', 'fact', 'action_item', 'question', 'context']

  return (
    <div className="flex flex-col gap-0 overflow-y-auto">
      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-text-primary truncate">{commit.message || 'Untitled'}</span>
          {snapshot.is_merge && (
            <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-400" style={{ background: 'rgba(16,185,129,0.12)' }}>
              merge
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
          <span className="font-mono text-text-tertiary">{commit.id.slice(0, 8)}</span>
          <span>{formatTimestamp(commit.created_at)}</span>
          <span className="text-emerald-400/70">{snapshot.branch_name}</span>
          {commit.user_id && <span>by {commit.user_id}</span>}
        </div>
        {snapshot.parent_ids.length > 0 && (
          <div className="mt-1 text-[10px] text-text-muted">
            parent{snapshot.parent_ids.length > 1 ? 's' : ''}: {snapshot.parent_ids.map(id => id.slice(0, 7)).join(', ')}
          </div>
        )}
        {snapshot.merged_from_branch && (
          <div className="mt-1 text-[10px] text-violet-400/70">
            merged from {snapshot.merged_from_branch}
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }} />

      {/* Context summary */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
          </svg>
          <span className="text-[11px] font-medium text-text-secondary">AI Memory State</span>
          <span
            className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa' }}
          >
            {snapshot.active_memory_count} memories
          </span>
        </div>
        <div className="text-[11px] leading-relaxed text-text-tertiary">{snapshot.context_summary}</div>
        {snapshot.compaction_snapshot_count > 0 && (
          <div className="mt-1.5 text-[10px] text-indigo-400/60">
            {snapshot.compaction_snapshot_count} compaction snapshot{snapshot.compaction_snapshot_count > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }} />

      {/* Memory groups */}
      <div className="px-4 py-2">
        {snapshot.active_memory_count === 0 ? (
          <div className="py-4 text-center text-[11px] text-text-muted">No memories at this snapshot</div>
        ) : (
          <div className="flex flex-col gap-1">
            {typeOrder.map(memType => {
              const memories = snapshot.grouped_memories[memType]
              if (!memories || memories.length === 0) return null
              const config = TYPE_CONFIG[memType] || TYPE_CONFIG.context
              const isExpanded = expandedType === memType

              return (
                <div key={memType}>
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
                    onClick={() => setExpandedType(isExpanded ? null : memType)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={config.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                      <path d={config.icon} />
                    </svg>
                    <span className="text-[11px] font-medium text-text-secondary">{config.label}</span>
                    <span
                      className="ml-auto rounded-full px-1.5 py-px text-[9px] font-medium"
                      style={{ background: `${config.color}15`, color: config.color }}
                    >
                      {memories.length}
                    </span>
                    <svg
                      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      className={`text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="flex flex-col gap-1.5 pb-2 pl-2 pt-1">
                      {memories.map(mem => (
                        <MemoryCard key={mem.id} memory={mem} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }} />

      {/* Reconstructed context (collapsible) */}
      {snapshot.reconstructed_context && (
        <details className="px-4 py-2 group">
          <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-text-muted hover:text-text-secondary list-none">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-open:rotate-90">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Reconstructed Context Prompt
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg px-3 py-2 text-[10px] leading-relaxed text-text-muted" style={{ background: 'rgba(255,255,255,0.02)' }}>
            {snapshot.reconstructed_context}
          </pre>
        </details>
      )}

      {/* Rewind button */}
      <div className="px-4 py-3">
        <button
          onClick={onRewind}
          className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[12px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, #7c3aed 0%, #8b5cf6 50%, #6d28d9 100%)',
            boxShadow: '0 2px 12px rgba(139,92,246,0.25)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          Rewind chat to this snapshot
        </button>
      </div>
    </div>
  )
}

export default function Timeline({ branchName, refreshKey, onCheckout }: Props) {
  const api = useApi()
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<CommitSnapshot | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadTimeline = async () => {
      setLoading(true)
      setError(null)
      try {
        const timeline = await api.getTimeline(branchName)
        if (!cancelled) setEntries(timeline ?? [])
      } catch (loadError) {
        if (!cancelled) {
          setEntries([])
          setError(loadError instanceof Error ? loadError.message : 'Failed to load timeline.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    setSelectedCommitId(null)
    setSnapshot(null)
    void loadTimeline()
    return () => { cancelled = true }
  }, [branchName, refreshKey])

  // Load snapshot when a commit is selected
  useEffect(() => {
    if (!selectedCommitId) {
      setSnapshot(null)
      return
    }

    let cancelled = false
    const loadSnapshot = async () => {
      setSnapshotLoading(true)
      setSnapshotError(null)
      try {
        const data = await api.getCommitSnapshot(selectedCommitId)
        if (!cancelled) setSnapshot(data)
      } catch (err) {
        if (!cancelled) setSnapshotError(err instanceof Error ? err.message : 'Failed to load snapshot')
      } finally {
        if (!cancelled) setSnapshotLoading(false)
      }
    }

    void loadSnapshot()
    return () => { cancelled = true }
  }, [selectedCommitId])

  const handleCommitClick = (commitId: string) => {
    setSelectedCommitId(prev => prev === commitId ? null : commitId)
  }

  const showInspector = selectedCommitId !== null

  return (
    <div className="flex h-full flex-col">
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="text-xs font-medium text-text-secondary tracking-wide">
          {showInspector ? 'Snapshot Inspector' : 'Timeline'}
        </span>
        <span className="font-mono text-[11px] text-emerald-400">{branchName}</span>
        {showInspector && (
          <button
            onClick={() => setSelectedCommitId(null)}
            className="ml-auto rounded p-0.5 text-text-muted hover:text-text-secondary hover:bg-white/[0.05] transition-colors"
            title="Back to timeline"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {showInspector ? (
          <SnapshotInspector
            snapshot={snapshot}
            loading={snapshotLoading}
            error={snapshotError}
            onRewind={() => {
              if (snapshot) onCheckout(snapshot.commit.id, snapshot.commit.message)
            }}
          />
        ) : (
          <div className="px-4 py-3">
            {loading && (
              <div className="flex items-center gap-2 py-6 text-xs text-text-muted">
                <div className="h-3 w-3 animate-spin rounded-full border border-text-muted border-t-emerald-400" />
                Loading...
              </div>
            )}

            {error && (
              <div className="rounded-lg px-3 py-2.5 text-xs text-red-300" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                {error}
              </div>
            )}

            {!loading && entries.length === 0 && !error && (
              <div className="py-8 text-center text-xs text-text-muted">No commits yet</div>
            )}

            <div className="relative">
              {(entries ?? []).map((entry, index) => {
                const isMerge = entry.commit.is_merge
                const isLast = index === entries.length - 1
                const isSelected = selectedCommitId === entry.commit.id

                return (
                  <div key={entry.commit.id} className="group relative flex gap-3 pb-0">
                    {/* Vertical line */}
                    <div className="relative flex w-4 flex-shrink-0 flex-col items-center">
                      <button
                        onClick={() => handleCommitClick(entry.commit.id)}
                        className="relative z-10 mt-0.5 flex h-4 w-4 items-center justify-center"
                        title={`Inspect: ${entry.commit.message}`}
                      >
                        {isMerge ? (
                          <span
                            className="h-3.5 w-3.5 rotate-45 rounded-sm transition-all"
                            style={{
                              background: isSelected ? '#8b5cf6' : '#10b981',
                              boxShadow: isSelected
                                ? '0 0 12px rgba(139,92,246,0.5)'
                                : '0 0 8px rgba(16,185,129,0.35)',
                            }}
                          />
                        ) : (
                          <span
                            className="h-2.5 w-2.5 rounded-full transition-all group-hover:scale-125"
                            style={
                              isSelected
                                ? { background: '#8b5cf6', border: '2px solid #a78bfa', boxShadow: '0 0 10px rgba(139,92,246,0.4)' }
                                : { background: '#3f3f46', border: '2px solid #52525b' }
                            }
                          />
                        )}
                      </button>
                      {!isLast && (
                        <div className="w-px flex-1 mt-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
                      )}
                    </div>

                    {/* Content */}
                    <button
                      className={`min-w-0 flex-1 pb-4 text-left rounded-md px-1.5 py-1 -ml-1.5 transition-colors ${
                        isSelected ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                      }`}
                      onClick={() => handleCommitClick(entry.commit.id)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[12px] truncate ${isSelected ? 'text-violet-300 font-medium' : 'text-text-secondary group-hover:text-text-primary'}`}>
                          {entry.commit.message || 'Untitled'}
                        </span>
                        {isMerge && (
                          <span
                            className="flex-shrink-0 rounded px-1 py-px text-[9px] font-medium uppercase text-emerald-400"
                            style={{ background: 'rgba(16,185,129,0.12)' }}
                          >
                            merge
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-muted">
                        <span className="font-mono">{entry.commit.id.slice(0, 7)}</span>
                        <span>{formatTimestamp(entry.commit.created_at)}</span>
                      </div>
                      {entry.commit.parent_ids && entry.commit.parent_ids.length > 1 && (
                        <div className="mt-0.5 text-[10px] text-text-muted">
                          parents: {entry.commit.parent_ids.map(pid => pid.slice(0, 7)).join(', ')}
                        </div>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
