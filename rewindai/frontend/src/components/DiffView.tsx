import { useEffect, useState } from 'react'
import type { DiffResult, Memory } from '../types'
import { useApi } from '../hooks/useApi'
import { MEMORY_TYPE_COLORS, formatTypeLabel } from '../utils/cytoscape'

function MemoryCard({ memory }: { memory: Memory }) {
  const badgeColor = MEMORY_TYPE_COLORS[memory.type as keyof typeof MEMORY_TYPE_COLORS] ?? '#64748b'

  return (
    <div className="rounded-2xl border border-border bg-surface/75 p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-2 py-1 text-[11px] font-medium text-white"
          style={{ background: badgeColor }}
        >
          {formatTypeLabel(memory.type)}
        </span>
        {(memory.tags ?? []).map(tag => (
          <span key={tag} className="rounded-full bg-black/20 px-2 py-1 text-[11px] text-slate-400">
            {tag}
          </span>
        ))}
      </div>
      <div className="text-sm leading-6 text-slate-100">{memory.content}</div>
    </div>
  )
}

export default function DiffView() {
  const api = useApi()
  const [branches, setBranches] = useState<string[]>([])
  const [branchA, setBranchA] = useState('main')
  const [branchB, setBranchB] = useState('graphql-exploration')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let cancelled = false

    const loadBranches = async () => {
      setLoadingBranches(true)
      setError(null)

      try {
        const fetchedBranches = await api.listBranches()
        const names = (fetchedBranches ?? []).map(branch => branch.name)
        const defaultA = names.includes('main') ? 'main' : names[0] ?? ''
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
  }, [])

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

    const loadDiff = async () => {
      if (!branchA || !branchB || branchA === branchB) {
        setDiff(null)
        return
      }

      setLoadingDiff(true)
      setError(null)

      try {
        const result = await api.diffBranches(branchA, branchB)
        if (!cancelled) {
          setDiff(result)
        }
      } catch (loadError) {
        if (!cancelled) {
          setDiff(null)
          setError(loadError instanceof Error ? loadError.message : 'Failed to compare branches.')
        }
      } finally {
        if (!cancelled) {
          setLoadingDiff(false)
        }
      }
    }

    void loadDiff()

    return () => {
      cancelled = true
    }
  }, [branchA, branchB, refreshTick])

  const onlyA = diff?.only_a ?? []
  const onlyB = diff?.only_b ?? []
  const readyToCompare = Boolean(branchA && branchB && branchA !== branchB)
  const identical = !loadingDiff && diff && onlyA.length === 0 && onlyB.length === 0

  return (
    <div className="flex h-full flex-col" style={{ background: '#0b0b12' }}>
      <div className="border-b border-border px-5 py-4">
        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Branch Diff</div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={branchA}
            onChange={event => setBranchA(event.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-slate-100 outline-none"
          >
            {(branches ?? []).map(branch => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
          <span className="text-sm text-slate-500">vs</span>
          <select
            value={branchB}
            onChange={event => setBranchB(event.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-slate-100 outline-none"
          >
            {(branches ?? []).filter(branch => branch !== branchA || branches.length === 1).map(branch => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
          <button
            onClick={() => setRefreshTick(prev => prev + 1)}
            className="rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 transition hover:border-purple-400 hover:text-purple-200"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {loadingBranches && (
          <div className="text-sm text-slate-500 animate-pulse">Loading branches...</div>
        )}

        {loadingDiff && (
          <div className="mb-4 text-sm text-slate-500 animate-pulse">Loading diff...</div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Failed to load diff. Check backend connection.
            <div className="mt-1 text-xs text-red-300/80">{error}</div>
          </div>
        )}

        {identical && (
          <div className="mb-4 rounded-2xl border border-dashed border-border bg-surface/60 px-5 py-6 text-sm text-slate-400">
            Branches are identical — no differences found.
          </div>
        )}

        {!loadingBranches && !loadingDiff && !error && !readyToCompare && (
          <div className="rounded-2xl border border-dashed border-border bg-surface/60 px-5 py-6 text-sm text-slate-400">
            Select two different branches to compare them side by side.
          </div>
        )}

        {!loadingBranches && !loadingDiff && !error && !identical && readyToCompare && (
          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-black/10">
              <div className="border-b border-border px-4 py-3 text-sm font-medium text-rose-300">
                Only on {diff?.branch_a ?? branchA}
              </div>
              <div className="space-y-3 p-4">
                {onlyA.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-slate-500">
                    No unique memories on this side.
                  </div>
                )}
                {onlyA.map(memory => (
                  <MemoryCard key={memory.id} memory={memory} />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-black/10">
              <div className="border-b border-border px-4 py-3 text-sm font-medium text-emerald-300">
                Only on {diff?.branch_b ?? branchB}
              </div>
              <div className="space-y-3 p-4">
                {onlyB.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-slate-500">
                    No unique memories on this side.
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
