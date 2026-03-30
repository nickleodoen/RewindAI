import { useEffect, useState } from 'react'
import ChatPanel from './components/ChatPanel'
import BranchManager from './components/BranchManager'
import GraphExplorer from './components/GraphExplorer'
import Timeline from './components/Timeline'
import DiffView from './components/DiffView'
import { useApi } from './hooks/useApi'
import type { HealthResponse } from './types'

type Tab = 'chat' | 'graph' | 'diff'

export default function App() {
  const api = useApi()
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [activeBranch, setActiveBranch] = useState('main')
  const [activeTab, setActiveTab] = useState<Tab>('graph')
  const [selectedNode, setSelectedNode] = useState<Record<string, unknown> | null>(null)
  const [checkoutOverlay, setCheckoutOverlay] = useState({ show: false, message: '' })
  const [branchRefreshKey, setBranchRefreshKey] = useState(0)
  const [healthStatus, setHealthStatus] = useState<HealthResponse | null>(null)
  const [appMessage, setAppMessage] = useState('')

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

    const bootstrapSession = async () => {
      try {
        const session = await api.createSession('main', 'demo')
        if (!cancelled) {
          setActiveSession(session.id)
        }
      } catch {
        if (!cancelled) {
          setAppMessage('Unable to start the demo session.')
        }
      }
    }

    if (!activeSession) {
      void bootstrapSession()
    }

    return () => {
      cancelled = true
    }
  }, [])

  const handleBranchChange = async (branchName: string) => {
    setActiveBranch(branchName)
    setSelectedNode(null)
    setActiveSession(null)
    setActiveTab('graph')

    try {
      const session = await api.createSession(branchName, 'demo')
      setActiveSession(session.id)
      setAppMessage(`Viewing branch ${branchName}`)
    } catch (error) {
      setAppMessage(error instanceof Error ? error.message : `Failed to open ${branchName}`)
    }
  }

  const handleCheckout = async (branchName: string, commitId: string, commitMessage: string) => {
    setCheckoutOverlay({ show: true, message: commitMessage })
    setSelectedNode(null)

    try {
      const data = await api.checkoutBranch(branchName, commitId, 'demo')
      if (data.session_id) {
        setActiveSession(data.session_id)
        setActiveBranch(data.branch_name || branchName)
        setBranchRefreshKey(prev => prev + 1)
        setAppMessage(`Checked out ${commitMessage}`)
        window.setTimeout(() => {
          setCheckoutOverlay({ show: false, message: '' })
          setActiveTab('chat')
        }, 1500)
        return
      }
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
      await api.createCommit(activeBranch, message, 'demo')
      setBranchRefreshKey(prev => prev + 1)
      setAppMessage(`Committed "${message}" on ${activeBranch}`)
    } catch (error) {
      setAppMessage(error instanceof Error ? error.message : 'Commit failed')
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0a0a0f', color: '#e2e8f0' }}>
      {checkoutOverlay.show && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(139, 92, 246, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '12px',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ fontSize: '48px' }}>⏪</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'white' }}>
            Rewinding...
          </div>
          <div style={{ fontSize: '16px', color: 'rgba(255,255,255,0.84)' }}>
            {checkoutOverlay.message}
          </div>
        </div>
      )}

      <header
        style={{
          background: '#12121a',
          borderBottom: '1px solid #1e1e2e',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: '#8b5cf6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
              color: 'white',
            }}
          >
            R
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: '18px', fontWeight: 600, color: 'white' }}>RewindAI</span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>git for AI memory</span>
          </div>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: 999,
              background: '#1e1e2e',
              color: '#8b5cf6',
            }}
          >
            Hackathon demo
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{ color: '#64748b' }}>Branch:</span>
          <span
            style={{
              fontFamily: 'monospace',
              padding: '2px 8px',
              borderRadius: 4,
              background: '#1e1e2e',
              color: '#10b981',
            }}
          >
            {activeBranch}
          </span>
          <span style={{ color: '#64748b' }}>
            Session: {activeSession ? activeSession.slice(0, 8) : 'starting'}
          </span>
          {appMessage && <span style={{ color: '#94a3b8' }}>{appMessage}</span>}
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <aside
          style={{
            width: 320,
            borderRight: '1px solid #1e1e2e',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            background: '#0f0f17',
          }}
        >
          <div style={{ flex: '0 0 58%', minHeight: 0, overflow: 'hidden' }}>
            <BranchManager
              activeBranch={activeBranch}
              onCheckout={handleCheckout}
              onBranchChange={handleBranchChange}
              refreshKey={branchRefreshKey}
            />
          </div>
          <div style={{ borderTop: '1px solid #1e1e2e', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
            <Timeline
              branchName={activeBranch}
              refreshKey={branchRefreshKey}
              onCheckout={(commitId, commitMessage) => handleCheckout(activeBranch, commitId, commitMessage)}
            />
          </div>
        </aside>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #1e1e2e', background: '#11111a' }}>
            {(['chat', 'graph', 'diff'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '10px 20px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: activeTab === tab ? '#8b5cf6' : '#64748b',
                  borderBottom: activeTab === tab ? '2px solid #8b5cf6' : '2px solid transparent',
                  background: 'transparent',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
            {activeTab === 'chat' && (
              <ChatPanel
                sessionId={activeSession}
                branchName={activeBranch}
                onCommit={handleCommit}
              />
            )}
            {activeTab === 'graph' && (
              <GraphExplorer
                key={`${activeBranch}-${branchRefreshKey}`}
                branchName={activeBranch}
                sessionId={activeSession}
                onNodeSelect={setSelectedNode}
              />
            )}
            {activeTab === 'diff' && <DiffView />}
          </div>
        </main>
      </div>

      <footer
        style={{
          borderTop: '1px solid #1e1e2e',
          padding: '6px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '12px',
          fontSize: '11px',
          color: '#475569',
          background: '#0d0d14',
        }}
      >
        <span>Neo4j: {healthStatus?.neo4j ?? 'checking'}</span>
        <span>{selectedNode ? `Selected: ${String(selectedNode.label || selectedNode.id || 'node')}` : 'Ready for demo'}</span>
        <span>RewindAI v0.1.0 — HackwithBay 2.0</span>
      </footer>
    </div>
  )
}
