import { useState, useEffect } from 'react'
import ChatPanel from './components/ChatPanel'
import BranchManager from './components/BranchManager'
import GraphExplorer from './components/GraphExplorer'
import Timeline from './components/Timeline'
import DiffView from './components/DiffView'
import { useApi } from './hooks/useApi'
import type { Branch } from './types'

type Tab = 'chat' | 'graph' | 'diff'

export default function App() {
  const [tab, setTab] = useState<Tab>('chat')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [branchName, setBranchName] = useState('main')
  const [userId, setUserId] = useState('alice')
  const [branches, setBranches] = useState<Branch[]>([])
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [status, setStatus] = useState('')
  const api = useApi()

  const refresh = () => setRefreshTrigger(t => t + 1)

  useEffect(() => {
    api.listBranches().then(b => {
      if (b) setBranches(b)
    })
  }, [refreshTrigger])

  const handleNewSession = async () => {
    const session = await api.createSession(branchName, userId)
    if (session) {
      setSessionId(session.id)
      setStatus(`Session ${session.id.slice(0, 8)} on ${branchName}`)
    }
  }

  const handleCompaction = (count: number) => {
    setStatus(`Compaction! ${count} memories extracted`)
    refresh()
  }

  const handleCheckout = async (newSessionId: string, newBranch: string) => {
    setSessionId(newSessionId)
    setBranchName(newBranch)
    setStatus(`Checked out ${newBranch} → session ${newSessionId.slice(0, 8)}`)
    refresh()
  }

  const handleCheckoutCommit = async (commitId: string) => {
    const result = await api.checkoutBranch(branchName, commitId, userId)
    if (result) {
      handleCheckout(result.session_id, result.branch_name)
    }
  }

  return (
    <div className="h-screen flex flex-col bg-bg text-zinc-200">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface/50">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-accent">RewindAI</h1>
          <span className="text-[10px] text-zinc-500">git for AI memory</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-zinc-500">
            Branch: <span className="text-emerald-400">{branchName}</span>
          </span>
          <select
            value={userId}
            onChange={e => setUserId(e.target.value)}
            className="bg-surface border border-border rounded px-2 py-1 text-xs text-zinc-300"
          >
            <option value="alice">Alice Chen</option>
            <option value="bob">Bob Kumar</option>
          </select>
          <button
            onClick={handleNewSession}
            className="px-3 py-1 bg-accent/20 text-accent text-xs rounded hover:bg-accent/30"
          >
            New Session
          </button>
          {status && <span className="text-[10px] text-zinc-500">{status}</span>}
        </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar: Branch Manager + Timeline */}
        <aside className="w-56 border-r border-border flex flex-col">
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="h-1/2 border-b border-border overflow-hidden">
              <BranchManager
                currentBranch={branchName}
                onBranchChange={setBranchName}
                onCheckout={handleCheckout}
                refreshTrigger={refreshTrigger}
              />
            </div>
            <div className="h-1/2 overflow-y-auto">
              <div className="p-3 text-xs text-zinc-500 border-b border-border">Timeline</div>
              <Timeline
                branchName={branchName}
                refreshTrigger={refreshTrigger}
                onCheckout={handleCheckoutCommit}
              />
            </div>
          </div>
        </aside>

        {/* Center: Tabs */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-border">
            {(['chat', 'graph', 'diff'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-xs capitalize ${
                  tab === t
                    ? 'text-accent border-b-2 border-accent'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden relative">
            {tab === 'chat' && (
              <ChatPanel
                sessionId={sessionId}
                branchName={branchName}
                userId={userId}
                onCompaction={handleCompaction}
                onCommit={refresh}
              />
            )}
            {tab === 'graph' && (
              <GraphExplorer branchName={branchName} refreshTrigger={refreshTrigger} />
            )}
            {tab === 'diff' && (
              <DiffView branches={branches.map(b => b.name)} />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
