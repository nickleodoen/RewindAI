import { useState, useEffect } from 'react'
import type { Branch, Commit } from '../types'
import { useApi } from '../hooks/useApi'

interface Props {
  currentBranch: string
  onBranchChange: (branch: string) => void
  onCheckout: (sessionId: string, branchName: string) => void
  refreshTrigger: number
}

export default function BranchManager({ currentBranch, onBranchChange, onCheckout, refreshTrigger }: Props) {
  const [branches, setBranches] = useState<Branch[]>([])
  const [commits, setCommits] = useState<Commit[]>([])
  const [newBranch, setNewBranch] = useState('')
  const [sourceCommit, setSourceCommit] = useState('')
  const [showNew, setShowNew] = useState(false)
  const api = useApi()

  const refresh = async () => {
    const b = await api.listBranches()
    if (b) setBranches(b)
    const c = await api.listCommits(currentBranch)
    if (c) setCommits(c)
  }

  useEffect(() => { refresh() }, [currentBranch, refreshTrigger])

  const handleCreate = async () => {
    if (!newBranch.trim()) return
    await api.createBranch(newBranch, sourceCommit || undefined)
    setNewBranch('')
    setSourceCommit('')
    setShowNew(false)
    refresh()
  }

  const handleCheckout = async (commitId?: string) => {
    const result = await api.checkoutBranch(currentBranch, commitId)
    if (result) {
      onCheckout(result.session_id, result.branch_name)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Branch selector */}
      <div className="p-3 border-b border-border">
        <div className="text-xs text-zinc-500 mb-1">Branch</div>
        <select
          value={currentBranch}
          onChange={e => onBranchChange(e.target.value)}
          className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm text-zinc-200"
        >
          {branches.map(b => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>
        <button
          onClick={() => setShowNew(!showNew)}
          className="mt-2 text-xs text-accent hover:text-purple-400"
        >
          + New Branch
        </button>
      </div>

      {/* New branch form */}
      {showNew && (
        <div className="p-3 border-b border-border space-y-2">
          <input
            value={newBranch}
            onChange={e => setNewBranch(e.target.value)}
            placeholder="Branch name..."
            className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-zinc-200"
          />
          <select
            value={sourceCommit}
            onChange={e => setSourceCommit(e.target.value)}
            className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-zinc-200"
          >
            <option value="">From latest</option>
            {commits.map(c => (
              <option key={c.id} value={c.id}>{c.message || c.id.slice(0, 8)}</option>
            ))}
          </select>
          <button
            onClick={handleCreate}
            className="w-full px-2 py-1.5 bg-accent text-white text-xs rounded hover:bg-purple-500"
          >
            Create Branch
          </button>
        </div>
      )}

      {/* Commit history */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-xs text-zinc-500 mb-2">Commits</div>
        {commits.length === 0 && (
          <div className="text-xs text-zinc-600">No commits yet</div>
        )}
        <div className="space-y-1">
          {commits.map((c, i) => (
            <div
              key={c.id}
              className="group flex items-start gap-2 p-2 rounded hover:bg-surface cursor-pointer"
              onClick={() => handleCheckout(c.id)}
            >
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full border-2 ${
                  i === 0 ? 'border-emerald-400 bg-emerald-400/20' : 'border-zinc-600 bg-transparent'
                }`} />
                {i < commits.length - 1 && <div className="w-0.5 h-6 bg-zinc-700" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-300 truncate">{c.message || 'Unnamed commit'}</div>
                <div className="text-[10px] text-zinc-600">{c.id.slice(0, 8)} · {c.user_id}</div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 text-[10px] text-accent">
                checkout
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
