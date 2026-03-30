import { useEffect, useMemo, useState } from 'react'
import ChatPanel from './components/ChatPanel'
import BranchManager from './components/BranchManager'
import GraphExplorer from './components/GraphExplorer'
import Timeline from './components/Timeline'
import DiffView from './components/DiffView'
import { useApi } from './hooks/useApi'
import type { HealthResponse, WorkspaceStatus } from './types'

type Tab = 'chat' | 'graph' | 'diff'

const DEMO_USER = 'demo'

const TAB_ICONS: Record<Tab, string> = {
  chat: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  graph: 'M13 10V3L4 14h7v7l9-11h-7z',
  diff: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
}

function shortId(value?: string | null) {
  return value ? value.slice(0, 8) : '—'
}

function StatusChip({ label, value, variant = 'default' }: { label: string; value: string; variant?: 'default' | 'mono' | 'success' | 'warning' | 'merge' }) {
  const valueClass = variant === 'mono'
    ? 'font-mono text-text-primary'
    : variant === 'success'
      ? 'font-mono text-emerald-400'
      : variant === 'warning'
        ? 'text-amber-400'
        : variant === 'merge'
          ? 'text-emerald-300'
          : 'text-text-secondary'

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-muted">{label}</span>
      <span className={`rounded px-1.5 py-0.5 text-[11px] leading-none ${valueClass}`} style={{ background: 'rgba(255,255,255,0.04)' }}>
        {value}
      </span>
    </div>
  )
}

export default function App() {
  const api = useApi()
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('graph')
  const [selectedNode, setSelectedNode] = useState<Record<string, unknown> | null>(null)
  const [checkoutOverlay, setCheckoutOverlay] = useState({ show: false, message: '' })
  const [branchRefreshKey, setBranchRefreshKey] = useState(0)
  const [healthStatus, setHealthStatus] = useState<HealthResponse | null>(null)
  const [appMessage, setAppMessage] = useState('Loading demo workspace...')

  const activeBranch = useMemo(
    () => workspaceStatus?.branch_name || workspaceStatus?.origin_branch || 'main',
    [workspaceStatus],
  )
  const activeSession = workspaceStatus?.session_id ?? null
  const workspaceMode = workspaceStatus?.mode ?? 'uninitialized'

  useEffect(() => {
    let cancelled = false

    const loadHealth = async () => {
      try {
        const health = await api.getHealth()
        if (!cancelled) {
          setHealthStatus(health)
        }
      } catch (error) {
        if (!cancelled) {
          setHealthStatus({ status: 'error', neo4j: 'unreachable' })
          setAppMessage(error instanceof Error ? error.message : 'Failed to reach backend')
        }
      }
    }

    void loadHealth()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const bootstrapWorkspace = async () => {
      try {
        const status = await api.getWorkspaceStatus(DEMO_USER)
        if (cancelled) {
          return
        }

        if (status.mode === 'uninitialized') {
          const checkout = await api.workspaceCheckout('main', DEMO_USER)
          if (!cancelled) {
            setWorkspaceStatus(checkout.status)
            setAppMessage("Workspace attached to main for the live demo flow.")
            setBranchRefreshKey(prev => prev + 1)
          }
          return
        }

        setWorkspaceStatus(status)
        setAppMessage(status.summary)
      } catch (error) {
        if (!cancelled) {
          setAppMessage(error instanceof Error ? error.message : 'Unable to initialize the demo workspace.')
        }
      }
    }

    void bootstrapWorkspace()

    return () => {
      cancelled = true
    }
  }, [])

  const handleBranchChange = async (branchName: string) => {
    if (workspaceMode === 'attached' && branchName === activeBranch) {
      setSelectedNode(null)
      setActiveTab('graph')
      return
    }

    setSelectedNode(null)
    setActiveTab('graph')

    try {
      const result = await api.workspaceAttachBranch(branchName, DEMO_USER)
      setWorkspaceStatus(result.status)
      setBranchRefreshKey(prev => prev + 1)
      setAppMessage(`Attached workspace to ${branchName}.`)
    } catch (error) {
      setAppMessage(error instanceof Error ? error.message : `Failed to attach ${branchName}.`)
    }
  }

  const handleCheckout = async (branchName: string, commitId: string, commitMessage: string) => {
    setCheckoutOverlay({ show: true, message: commitMessage })
    setSelectedNode(null)

    try {
      const result = await api.workspaceCheckout(commitId, DEMO_USER)
      setWorkspaceStatus(result.status)
      setBranchRefreshKey(prev => prev + 1)
      setAppMessage(`Rewound ${branchName} to ${commitMessage}.`)
      window.setTimeout(() => {
        setCheckoutOverlay({ show: false, message: '' })
        setActiveTab('chat')
      }, 1500)
      return
    } catch (error) {
      setAppMessage(error instanceof Error ? error.message : 'Checkout failed')
    }

    setCheckoutOverlay({ show: false, message: '' })
  }

  const handleCommit = async (message: string) => {
    if (!message.trim()) {
      return
    }

    try {
      const result = await api.workspaceCommit(message, DEMO_USER)
      setWorkspaceStatus(result.status)
      setBranchRefreshKey(prev => prev + 1)
      setAppMessage(result.summary || `Committed "${message}" on ${activeBranch}.`)
    } catch (error) {
      setAppMessage(error instanceof Error ? error.message : 'Commit failed')
      throw error
    }
  }

  const neo4jOk = healthStatus?.neo4j === 'connected'

  return (
    <div className="flex h-screen flex-col" style={{ background: '#09090b', color: '#f0f0f3' }}>
      {/* Checkout overlay */}
      {checkoutOverlay.show && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
          style={{
            background: 'rgba(9,9,11,0.92)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'rgba(139,92,246,0.15)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </div>
          <div className="text-lg font-semibold text-text-primary">Rewinding memory state</div>
          <div className="max-w-sm text-center text-sm text-text-secondary">{checkoutOverlay.message}</div>
          <div className="mt-2 h-1 w-32 overflow-hidden rounded-full" style={{ background: 'rgba(139,92,246,0.15)' }}>
            <div className="h-full animate-pulse rounded-full bg-accent" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* Header */}
      <header
        className="flex items-center justify-between gap-4 px-5 py-2.5"
        style={{ background: '#0c0c0f', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-xs font-bold text-white">
            R
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-text-primary tracking-tight">RewindAI</span>
            <span className="text-[11px] text-text-muted">git for AI memory</span>
          </div>
        </div>

        {/* Workspace status bar */}
        <div className="flex items-center gap-4 text-[11px]">
          <StatusChip label="Branch" value={activeBranch} variant="success" />
          <StatusChip
            label="Mode"
            value={workspaceMode}
            variant={workspaceMode === 'detached' ? 'warning' : 'default'}
          />
          <StatusChip label="HEAD" value={shortId(workspaceStatus?.head_commit_id)} variant="mono" />
          {workspaceStatus?.head_is_merge && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
              style={{ background: 'rgba(16,185,129,0.12)' }}
            >
              merge
            </span>
          )}
          <StatusChip label="Session" value={shortId(activeSession)} variant="mono" />
          <div className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: neo4jOk ? '#10b981' : '#ef4444' }}
            />
            <span className="text-text-muted">Neo4j</span>
          </div>
        </div>
      </header>

      {/* Status message bar */}
      {appMessage && (
        <div
          className="flex items-center px-5 py-1.5 text-[11px] text-text-tertiary"
          style={{ background: '#0b0b0e', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-2 flex-shrink-0 opacity-50">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <span className="truncate">{appMessage}</span>
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <aside
          className="flex w-[300px] flex-col min-h-0"
          style={{ background: '#0c0c0f', borderRight: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex-[6] min-h-0 overflow-hidden">
            <BranchManager
              activeBranch={activeBranch}
              onCheckout={handleCheckout}
              onBranchChange={handleBranchChange}
              refreshKey={branchRefreshKey}
            />
          </div>
          <div className="flex-[4] min-h-0 overflow-hidden" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <Timeline
              branchName={activeBranch}
              refreshKey={branchRefreshKey}
              onCheckout={(commitId, commitMessage) => handleCheckout(activeBranch, commitId, commitMessage)}
            />
          </div>
        </aside>

        {/* Main content */}
        <main className="flex flex-1 flex-col min-w-0 min-h-0">
          {/* Tab bar */}
          <div
            className="flex items-center gap-0.5 px-2 pt-1"
            style={{ background: '#0b0b0e', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            {(['graph', 'chat', 'diff'] as const).map(tab => {
              const isActive = activeTab === tab
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'text-text-primary'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  style={{
                    background: isActive ? '#09090b' : 'transparent',
                    borderBottom: isActive ? '2px solid #8b5cf6' : '2px solid transparent',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                    <path d={TAB_ICONS[tab]} />
                  </svg>
                  <span className="capitalize">{tab}</span>
                </button>
              )
            })}
          </div>

          {/* Content area */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {activeTab === 'chat' && (
              <ChatPanel
                sessionId={activeSession}
                branchName={activeBranch}
                onCommit={handleCommit}
              />
            )}
            {activeTab === 'graph' && (
              <GraphExplorer
                key={`${activeBranch}-${branchRefreshKey}-${workspaceStatus?.head_commit_id ?? 'none'}`}
                branchName={activeBranch}
                sessionId={activeSession}
                workspaceMode={workspaceMode}
                headCommitId={workspaceStatus?.head_commit_id ?? null}
                headIsMerge={workspaceStatus?.head_is_merge ?? false}
                onNodeSelect={setSelectedNode}
              />
            )}
            {activeTab === 'diff' && (
              <DiffView
                activeBranch={activeBranch}
                workspaceMode={workspaceMode}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
