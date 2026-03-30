import { useEffect, useState } from 'react'
import type { Branch, Commit } from '../types'
import { useApi } from '../hooks/useApi'

interface Props {
  activeBranch: string
  onCheckout: (branchName: string, commitId: string, commitMessage: string) => void
  onBranchChange: (branch: string) => void
  refreshKey: number
}

function formatDate(value?: string) {
  if (!value) {
    return 'Unknown date'
  }

  return new Date(value).toLocaleDateString()
}

function truncateMessage(message: string, max = 50) {
  if (message.length <= max) {
    return message
  }

  return `${message.slice(0, max - 1)}…`
}

function sortCommits(commits: Commit[]) {
  return [...commits].sort((left, right) => {
    const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0
    const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0
    return rightTime - leftTime
  })
}

export default function BranchManager({ activeBranch, onCheckout, onBranchChange, refreshKey }: Props) {
  const api = useApi()
  const [branches, setBranches] = useState<Branch[]>([])
  const [commitsByBranch, setCommitsByBranch] = useState<Record<string, Commit[]>>({})
  const [expandedBranch, setExpandedBranch] = useState(activeBranch)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setExpandedBranch(activeBranch)
  }, [activeBranch])

  useEffect(() => {
    let cancelled = false

    const loadBranches = async () => {
      setLoading(true)
      setError(null)

      try {
        const fetchedBranches = await api.listBranches()
        const commitPairs = await Promise.all(
          (fetchedBranches ?? []).map(async branch => {
            try {
              const commits = await api.listCommits(branch.name)
              return [branch.name, sortCommits(commits ?? [])] as const
            } catch {
              return [branch.name, []] as const
            }
          }),
        )

        if (!cancelled) {
          setBranches(fetchedBranches ?? [])
          setCommitsByBranch(Object.fromEntries(commitPairs))
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load branches.')
          setBranches([])
          setCommitsByBranch({})
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadBranches()

    return () => {
      cancelled = true
    }
  }, [activeBranch, refreshKey])

  const handleNewBranch = async () => {
    const newName = window.prompt('New branch name')
    if (!newName || !newName.trim()) {
      return
    }

    const latestCommit = (commitsByBranch[activeBranch] ?? [])[0]

    try {
      await api.createBranch(newName.trim(), latestCommit?.id, 'demo')
      setExpandedBranch(newName.trim())
      onBranchChange(newName.trim())
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create branch.')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-4">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Branches</div>
          <div className="mt-1 text-sm text-slate-300">Checkout any commit to rewind context</div>
        </div>
        <button
          onClick={handleNewBranch}
          className="rounded-lg border border-purple-500/35 bg-purple-500/10 px-3 py-2 text-xs font-medium text-purple-200 transition hover:bg-purple-500/20"
        >
          New Branch
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <div className="text-sm text-slate-500 animate-pulse">Loading branches...</div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Failed to load branches. Check backend connection.
            <div className="mt-1 text-xs text-red-300/80">{error}</div>
          </div>
        )}

        {!loading && branches.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-slate-500">
            No branches found yet.
          </div>
        )}

        <div className="space-y-3">
          {(branches ?? []).map(branch => {
            const commits = commitsByBranch[branch.name] ?? []
            const isExpanded = expandedBranch === branch.name
            const isActive = branch.name === activeBranch

            return (
              <div key={branch.name} className="rounded-2xl border border-border bg-surface/60">
                <button
                  onClick={() => {
                    setExpandedBranch(branch.name)
                    onBranchChange(branch.name)
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: isActive ? '#10b981' : '#64748b' }}
                    />
                    <div className="min-w-0">
                      <div className="font-mono text-sm text-slate-100">{branch.name}</div>
                      <div className="text-xs text-slate-500">
                        {commits.length} commit{commits.length === 1 ? '' : 's'} • created {formatDate(branch.created_at)}
                      </div>
                      {branch.head_message && (
                        <div className="mt-1 text-xs text-slate-400">
                          tip: {truncateMessage(branch.head_message, 58)}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500">{isExpanded ? 'Hide' : 'Show'}</span>
                </button>

                {isExpanded && (
                  <div className="space-y-2 border-t border-border px-3 py-3">
                    {commits.length === 0 && (
                      <div className="rounded-xl border border-dashed border-border px-3 py-4 text-xs text-slate-500">
                        No commits on this branch yet.
                      </div>
                    )}

                    {commits.map(commit => (
                      <div
                        key={commit.id}
                        className="rounded-xl border border-white/5 bg-black/10 px-3 py-3"
                        style={{
                          borderLeft: `3px solid ${branch.name === 'main' ? '#10b981' : '#8b5cf6'}`,
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm text-slate-100">
                              <span>{truncateMessage(commit.message || 'Untitled commit')}</span>
                              {commit.is_merge && (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-emerald-300">
                                  merge
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {formatDate(commit.created_at)} • {commit.id.slice(0, 8)}
                            </div>
                          </div>
                          <button
                            onClick={() => onCheckout(branch.name, commit.id, commit.message)}
                            className="shrink-0 rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 transition hover:border-purple-400 hover:text-purple-200"
                          >
                            Checkout
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
