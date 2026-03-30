import { useEffect, useState } from 'react'
import type { TimelineEntry } from '../types'
import { useApi } from '../hooks/useApi'

interface Props {
  branchName: string
  refreshKey: number
  onCheckout: (commitId: string, commitMessage: string) => void
}

function formatTimestamp(value?: string) {
  if (!value) {
    return 'Unknown time'
  }

  return new Date(value).toLocaleString()
}

export default function Timeline({ branchName, refreshKey, onCheckout }: Props) {
  const api = useApi()
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadTimeline = async () => {
      setLoading(true)
      setError(null)

      try {
        const timeline = await api.getTimeline(branchName)
        if (!cancelled) {
          setEntries(timeline ?? [])
        }
      } catch (loadError) {
        if (!cancelled) {
          setEntries([])
          setError(loadError instanceof Error ? loadError.message : 'Failed to load timeline.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadTimeline()

    return () => {
      cancelled = true
    }
  }, [branchName, refreshKey])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Timeline</div>
        <div className="mt-1 text-sm text-slate-300">
          Commit history for <span className="font-mono text-emerald-400">{branchName}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <div className="text-sm text-slate-500 animate-pulse">Loading timeline...</div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Failed to load timeline. Check backend connection.
            <div className="mt-1 text-xs text-red-300/80">{error}</div>
          </div>
        )}

        {!loading && entries.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-slate-500">
            No commit history on this branch yet.
          </div>
        )}

        <div className="space-y-0">
          {(entries ?? []).map((entry, index) => (
            <div key={entry.commit.id} className="flex gap-3">
              <div className="flex w-6 flex-col items-center">
                <button
                  onClick={() => onCheckout(entry.commit.id, entry.commit.message)}
                  className="h-4 w-4 rounded-full border-2 border-emerald-400 bg-emerald-500/20 transition hover:bg-emerald-500/40"
                  title={`Checkout ${entry.commit.message}`}
                />
                {index < entries.length - 1 && <div className="mt-1 h-full w-px bg-slate-700" />}
              </div>

              <div className="pb-5">
                <div className="flex items-center gap-2 text-sm text-slate-100">
                  <span>{entry.commit.message || 'Untitled commit'}</span>
                  {entry.commit.is_merge && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-emerald-300">
                      merge
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-500">{formatTimestamp(entry.commit.created_at)}</div>
                <div className="mt-1 text-[11px] text-slate-600">
                  {entry.commit.id.slice(0, 8)}
                  {entry.commit.parent_ids && entry.commit.parent_ids.length > 1
                    ? ` ⇢ ${entry.commit.parent_ids.map(parentId => parentId.slice(0, 8)).join(', ')}`
                    : entry.parent_id
                      ? ` → ${entry.parent_id.slice(0, 8)}`
                      : ' • root commit'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
