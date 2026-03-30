import { useState } from 'react'
import type { DiffResult } from '../types'
import { useApi } from '../hooks/useApi'
import { NODE_COLORS } from '../utils/cytoscape'

export default function DiffView() {
  const branches = ['main', 'graphql-exploration']
  const [branchA, setBranchA] = useState(branches[0] || 'main')
  const [branchB, setBranchB] = useState(branches[1] || '')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const api = useApi()

  const runDiff = async () => {
    if (!branchA || !branchB || branchA === branchB) return
    const result = await api.diffBranches(branchA, branchB)
    setDiff(result)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <select
          value={branchA}
          onChange={e => setBranchA(e.target.value)}
          className="bg-surface border border-border rounded px-2 py-1 text-xs text-zinc-200"
        >
          {branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="text-xs text-zinc-500">vs</span>
        <select
          value={branchB}
          onChange={e => setBranchB(e.target.value)}
          className="bg-surface border border-border rounded px-2 py-1 text-xs text-zinc-200"
        >
          <option value="">Select branch...</option>
          {branches.filter(b => b !== branchA).map(b => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <button
          onClick={runDiff}
          disabled={!branchB || branchA === branchB}
          className="px-3 py-1 bg-accent text-white text-xs rounded hover:bg-purple-500 disabled:opacity-50"
        >
          Diff
        </button>
      </div>

      {/* Diff result */}
      {diff && (
        <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-0">
          {/* Branch A */}
          <div className="border-r border-border p-3">
            <div className="text-xs font-medium text-rose-400 mb-2">
              Only in {diff.branch_a} ({diff.only_a.length})
            </div>
            {diff.only_a.map(m => (
              <div key={m.id} className="mb-2 p-2 bg-rose-500/5 rounded border border-rose-500/20">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[m.type] || '#64748b' }} />
                  <span className="text-[10px] text-zinc-500">{m.type.replace('_', ' ')}</span>
                </div>
                <p className="text-xs text-zinc-300">{m.content}</p>
              </div>
            ))}
            {diff.only_a.length === 0 && <p className="text-xs text-zinc-600">No unique memories</p>}
          </div>

          {/* Branch B */}
          <div className="p-3">
            <div className="text-xs font-medium text-emerald-400 mb-2">
              Only in {diff.branch_b} ({diff.only_b.length})
            </div>
            {diff.only_b.map(m => (
              <div key={m.id} className="mb-2 p-2 bg-emerald-500/5 rounded border border-emerald-500/20">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[m.type] || '#64748b' }} />
                  <span className="text-[10px] text-zinc-500">{m.type.replace('_', ' ')}</span>
                </div>
                <p className="text-xs text-zinc-300">{m.content}</p>
              </div>
            ))}
            {diff.only_b.length === 0 && <p className="text-xs text-zinc-600">No unique memories</p>}
          </div>
        </div>
      )}

      {!diff && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-zinc-600 text-sm">Select two branches and click Diff</p>
        </div>
      )}
    </div>
  )
}
