import { useEffect, useState } from 'react'
import type { DiffResult, Memory, MergePreview } from '../types'
import { useApi } from '../hooks/useApi'
import { MEMORY_TYPE_COLORS, formatTypeLabel } from '../utils/cytoscape'

interface Props {
  activeBranch: string
  workspaceMode: 'attached' | 'detached' | 'uninitialized'
}

function MemoryCard({ memory }: { memory: Memory }) {
  const badgeColor = MEMORY_TYPE_COLORS[memory.type as keyof typeof MEMORY_TYPE_COLORS] ?? '#64748b'

  return (
    <div
      className="rounded-lg p-3.5"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
          style={{ background: `${badgeColor}cc` }}
        >
          {formatTypeLabel(memory.type)}
        </span>
        {(memory.tags ?? []).map(tag => (
          <span
            key={tag}
            className="rounded px-1.5 py-0.5 text-[10px] text-text-muted"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="text-[13px] leading-relaxed text-text-secondary">{memory.content}</div>
    </div>
  )
}

function MergeSummaryCard({ preview, loading, error }: { preview: MergePreview | null; loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-4 py-3 text-xs text-text-muted"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="h-3 w-3 animate-spin rounded-full border border-text-muted border-t-accent" />
        Loading merge preview...
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg px-4 py-3 text-xs text-red-300" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
        Unable to load merge preview
        <div className="mt-1 text-red-300/60">{error}</div>
      </div>
    )
  }

  if (!preview) {
    return null
  }

  const modeColors: Record<string, { bg: string; border: string; text: string; label: string }> = {
    'up_to_date': { bg: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.15)', text: '#6ee7b7', label: 'Up to date' },
    'fast_forward': { bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.15)', text: '#93c5fd', label: 'Fast-forward' },
    'merge_required': { bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.15)', text: '#fcd34d', label: 'Merge required' },
  }
  const modeStyle = modeColors[preview.mode] ?? modeColors['merge_required']
  const conflict = preview.conflicts[0]

  return (
    <div className="rounded-lg p-4" style={{ background: modeStyle.bg, border: `1px solid ${modeStyle.border}` }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={modeStyle.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M13 6h3a2 2 0 0 1 2 2v7" />
            <line x1="6" y1="9" x2="6" y2="21" />
          </svg>
          <span className="text-xs font-medium" style={{ color: modeStyle.text }}>Merge Preview</span>
        </div>
        <span className="rounded px-2 py-0.5 text-[10px] font-medium" style={{ background: `${modeStyle.text}15`, color: modeStyle.text }}>
          {modeStyle.label}
        </span>
      </div>

      <div className="mt-2 text-[13px] text-text-secondary">
        {preview.source_branch} into {preview.target_branch}
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-text-muted">
        <span>Base: <span className="font-mono text-text-tertiary">{preview.merge_base_commit_id?.slice(0, 7) ?? '—'}</span></span>
        <span>Conflicts: <span className={preview.conflicts.length > 0 ? 'text-amber-400' : 'text-emerald-400'}>{preview.conflicts.length}</span></span>
        <span>Auto-merged: <span className="text-text-tertiary">{preview.auto_merged.length}</span></span>
      </div>

      {conflict && (
        <div className="mt-3 rounded-md p-3 text-xs" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.1)' }}>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">Conflict</div>
          <div className="text-amber-100/90">{conflict.reason}</div>
          <div className="mt-2 space-y-1 text-text-muted">
            <div className="truncate">Target: {conflict.memory_a.content}</div>
            <div className="truncate">Source: {conflict.memory_b.content}</div>
          </div>
        </div>
      )}
      {!conflict && preview.auto_merged[0] && (
        <div className="mt-3 rounded-md p-3 text-xs" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.1)' }}>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-emerald-400">Auto-merged</div>
          <div className="text-emerald-100/80">{preview.auto_merged[0].content}</div>
        </div>
      )}
    </div>
  )
}

export default function DiffView({ activeBranch, workspaceMode }: Props) {
  const api = useApi()
  const [branches, setBranches] = useState<string[]>([])
  const [branchA, setBranchA] = useState('main')
  const [branchB, setBranchB] = useState('graphql-exploration')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null)
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [loadingMergePreview, setLoadingMergePreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let cancelled = false

    const loadBranches = async () => {
      setLoadingBranches(true)
      setError(null)

      try {
        const fetchedBranches = await api.listBranches()
        const names = (fetchedBranches ?? []).map(branch => branch.name)
        const defaultA = names.includes(activeBranch) ? activeBranch : names.includes('main') ? 'main' : names[0] ?? ''
        const defaultB = names.includes('graphql-exploration')
          ? 'graphql-exploration'
          : names.find(name => name !== defaultA) ?? ''

        if (!cancelled) {
          setBranches(names)
          setBranchA(defaultA)
          setBranchB(defaultB)
        }
      } catch (loadError) {
        if (!cancelled) {
          setBranches([])
          setError(loadError instanceof Error ? loadError.message : 'Failed to load branches.')
        }
      } finally {
        if (!cancelled) {
          setLoadingBranches(false)
        }
      }
    }

    void loadBranches()

    return () => {
      cancelled = true
    }
  }, [activeBranch])

  useEffect(() => {
    if (branchA && branchA === branchB) {
      const fallbackBranch = branches.find(name => name !== branchA) ?? ''
      if (fallbackBranch) {
        setBranchB(fallbackBranch)
      }
    }
  }, [branchA, branchB, branches])

  useEffect(() => {
    let cancelled = false

    const loadViews = async () => {
      if (!branchA || !branchB || branchA === branchB) {
        setDiff(null)
        setMergePreview(null)
        return
      }

      setLoadingDiff(true)
      setLoadingMergePreview(true)
      setError(null)
      setMergeError(null)

      try {
        const [diffResult, previewResult] = await Promise.all([
          api.diffBranches(branchA, branchB),
          api.mergePreview(branchB, branchA),
        ])
        if (!cancelled) {
          setDiff(diffResult)
          setMergePreview(previewResult)
        }
      } catch (loadError) {
        if (!cancelled) {
          setDiff(null)
          setMergePreview(null)
          const message = loadError instanceof Error ? loadError.message : 'Failed to compare branches.'
          setError(message)
          setMergeError(message)
        }
      } finally {
        if (!cancelled) {
          setLoadingDiff(false)
          setLoadingMergePreview(false)
        }
      }
    }

    void loadViews()

    return () => {
      cancelled = true
    }
  }, [branchA, branchB, refreshTick])

  const onlyA = diff?.only_a ?? []
  const onlyB = diff?.only_b ?? []
  const readyToCompare = Boolean(branchA && branchB && branchA !== branchB)
  const identical = !loadingDiff && diff && onlyA.length === 0 && onlyB.length === 0

  return (
    <div className="flex h-full flex-col" style={{ background: '#09090b' }}>
      {/* Diff header */}
      <div className="px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
              <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
            <span className="text-xs font-medium text-text-secondary">Branch Diff</span>
          </div>
          <button
            onClick={() => setRefreshTick(prev => prev + 1)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-text-muted transition-colors hover:text-text-secondary"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Branch selectors */}
        <div className="mt-3 flex items-center gap-2">
          <select
            value={branchA}
            onChange={event => setBranchA(event.target.value)}
            className="rounded-md px-3 py-1.5 text-[13px] text-text-primary outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {(branches ?? []).map(branch => (
              <option key={branch} value={branch}>{branch}</option>
            ))}
          </select>
          <div className="flex items-center gap-1 text-text-muted">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
          <select
            value={branchB}
            onChange={event => setBranchB(event.target.value)}
            className="rounded-md px-3 py-1.5 text-[13px] text-text-primary outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {(branches ?? []).filter(branch => branch !== branchA || branches.length === 1).map(branch => (
              <option key={branch} value={branch}>{branch}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Merge preview */}
        <div className="mb-4">
          <MergeSummaryCard preview={mergePreview} loading={loadingMergePreview} error={mergeError} />
        </div>

        {loadingBranches && (
          <div className="flex items-center gap-2 py-6 text-xs text-text-muted">
            <div className="h-3 w-3 animate-spin rounded-full border border-text-muted border-t-accent" />
            Loading branches...
          </div>
        )}

        {loadingDiff && (
          <div className="flex items-center gap-2 py-4 text-xs text-text-muted">
            <div className="h-3 w-3 animate-spin rounded-full border border-text-muted border-t-accent" />
            Loading diff...
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg px-4 py-3 text-xs text-red-300" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
            {error}
          </div>
        )}

        {identical && (
          <div className="rounded-lg px-5 py-6 text-center text-sm text-text-muted" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            Branches are identical — no differences found.
          </div>
        )}

        {!loadingBranches && !loadingDiff && !error && !readyToCompare && (
          <div className="rounded-lg px-5 py-8 text-center text-sm text-text-muted" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            Select two different branches to compare.
          </div>
        )}

        {/* Side-by-side diff panels */}
        {!loadingBranches && !loadingDiff && !error && !identical && readyToCompare && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Branch A panel */}
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
              <div
                className="flex items-center justify-between px-4 py-2.5"
                style={{ background: 'rgba(244,63,94,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: '#f43f5e' }} />
                  <span className="font-mono text-[13px] font-medium text-rose-300">{diff?.branch_a ?? branchA}</span>
                </div>
                <span className="text-[11px] text-text-muted">{onlyA.length} unique</span>
              </div>
              <div className="space-y-2 p-3" style={{ background: 'rgba(244,63,94,0.02)' }}>
                {onlyA.length === 0 && (
                  <div className="px-3 py-5 text-center text-xs text-text-muted">
                    No unique memories
                  </div>
                )}
                {onlyA.map(memory => (
                  <MemoryCard key={memory.id} memory={memory} />
                ))}
              </div>
            </div>

            {/* Branch B panel */}
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
              <div
                className="flex items-center justify-between px-4 py-2.5"
                style={{ background: 'rgba(16,185,129,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: '#10b981' }} />
                  <span className="font-mono text-[13px] font-medium text-emerald-300">{diff?.branch_b ?? branchB}</span>
                </div>
                <span className="text-[11px] text-text-muted">{onlyB.length} unique</span>
              </div>
              <div className="space-y-2 p-3" style={{ background: 'rgba(16,185,129,0.02)' }}>
                {onlyB.length === 0 && (
                  <div className="px-3 py-5 text-center text-xs text-text-muted">
                    No unique memories
                  </div>
                )}
                {onlyB.map(memory => (
                  <MemoryCard key={memory.id} memory={memory} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
