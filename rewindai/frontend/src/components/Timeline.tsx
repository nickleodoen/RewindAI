import { useEffect, useState } from 'react'
import type { TimelineEntry } from '../types'
import { useApi } from '../hooks/useApi'

interface Props {
  branchName: string
  refreshKey: number
  onCheckout: (commitId: string, commitMessage: string) => void
}

export default function Timeline({ branchName, refreshKey, onCheckout }: Props) {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const api = useApi()

  useEffect(() => {
    api.getTimeline(branchName).then(e => {
      setEntries(e)
    })
  }, [branchName, refreshKey])

  if (entries.length === 0) {
    return <div className="p-4 text-xs text-zinc-600">No timeline data</div>
  }

  return (
    <div className="p-4 space-y-0">
      {entries.map((entry, i) => (
        <div key={entry.commit.id} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div
              className="w-4 h-4 rounded-full border-2 border-emerald-500 bg-emerald-500/20 cursor-pointer hover:bg-emerald-500/40"
              onClick={() => onCheckout(entry.commit.id, entry.commit.message)}
              title={`Checkout ${entry.commit.id.slice(0, 8)}`}
            />
            {i < entries.length - 1 && <div className="w-0.5 h-8 bg-zinc-700" />}
          </div>
          <div className="pb-4">
            <div className="text-xs text-zinc-300">{entry.commit.message || 'Unnamed'}</div>
            <div className="text-[10px] text-zinc-600">
              {entry.commit.id.slice(0, 8)} · {entry.commit.user_id}
              {entry.parent_id && ` → ${entry.parent_id.slice(0, 8)}`}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
