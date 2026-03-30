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
    return '—'
  }

  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span className="text-xs font-medium text-text-secondary tracking-wide">Branches</span>
        </div>
        <button
          onClick={handleNewBranch}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-accent transition-colors hover:text-white"
          style={{ background: 'rgba(139,92,246,0.08)' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New
        </button>
      </div>

      {/* Branch list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && (
          <div className="flex items-center gap-2 px-2 py-6 text-xs text-text-muted">
            <div className="h-3 w-3 animate-spin rounded-full border border-text-muted border-t-accent" />
            Loading branches...
          </div>
        )}

        {error && (
          <div className="mx-1 rounded-lg px-3 py-2.5 text-xs text-red-300" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
            {error}
          </div>
        )}

        {!loading && branches.length === 0 && !error && (
          <div className="px-2 py-8 text-center text-xs text-text-muted">
            No branches yet
          </div>
        )}

        <div className="space-y-1">
          {(branches ?? []).map(branch => {
            const commits = commitsByBranch[branch.name] ?? []
            const isExpanded = expandedBranch === branch.name
            const isActive = branch.name === activeBranch

            return (
              <div key={branch.name}>
                {/* Branch row */}
                <button
                  onClick={() => {
                    setExpandedBranch(branch.name)
                    onBranchChange(branch.name)
                  }}
                  className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
                  style={{
                    background: isActive ? 'rgba(139,92,246,0.08)' : 'transparent',
                  }}
                >
                  {/* Branch indicator dot */}
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{
                      background: isActive ? '#10b981' : '#3f3f46',
                      boxShadow: isActive ? '0 0 6px rgba(16,185,129,0.4)' : 'none',
                    }}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-[13px] ${isActive ? 'text-text-primary font-medium' : 'text-text-secondary group-hover:text-text-primary'}`}>
                        {branch.name}
                      </span>
                      <span className="text-[10px] text-text-muted">{commits.length}</span>
                    </div>
                    {branch.head_message && (
                      <div className="mt-0.5 text-[11px] text-text-muted truncate">
                        {truncateMessage(branch.head_message, 40)}
                      </div>
                    )}
                  </div>

                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`flex-shrink-0 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {/* Commit list */}
                {isExpanded && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-3 pb-1" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                    {commits.length === 0 && (
                      <div className="py-3 text-[11px] text-text-muted">No commits yet</div>
                    )}

                    {commits.map(commit => (
                      <div
                        key={commit.id}
                        className="group/commit flex items-start justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] text-text-secondary group-hover/commit:text-text-primary truncate">
                              {truncateMessage(commit.message || 'Untitled', 36)}
                            </span>
                            {commit.is_merge && (
                              <span
                                className="flex-shrink-0 rounded px-1 py-px text-[9px] font-medium uppercase text-emerald-400"
                                style={{ background: 'rgba(16,185,129,0.12)' }}
                              >
                                merge
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-muted">
                            <span className="font-mono">{commit.id.slice(0, 7)}</span>
                            <span>{formatDate(commit.created_at)}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => onCheckout(branch.name, commit.id, commit.message)}
                          className="flex-shrink-0 rounded px-2 py-1 text-[10px] font-medium text-text-muted opacity-0 transition-all group-hover/commit:opacity-100 hover:text-accent"
                          style={{ background: 'rgba(255,255,255,0.04)' }}
                        >
                          checkout
                        </button>
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
