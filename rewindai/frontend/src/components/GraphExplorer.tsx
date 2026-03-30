import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import coseBilkent from 'cytoscape-cose-bilkent'
import type { GraphData } from '../types'
import { useApi } from '../hooks/useApi'
import {
  GRAPH_LEGEND_ITEMS,
  NODE_COLORS,
  cytoscapeStyle,
  filterDemoGraph,
  formatTypeLabel,
  toCytoscapeElements,
} from '../utils/cytoscape'

let layoutRegistered = false
let layoutName: 'cose-bilkent' | 'cose' = 'cose'
if (!layoutRegistered) {
  try {
    cytoscape.use(coseBilkent)
    layoutRegistered = true
    layoutName = 'cose-bilkent'
  } catch {
    layoutRegistered = true
    layoutName = 'cose'
  }
}

interface Props {
  branchName: string
  sessionId: string | null
  workspaceMode: 'attached' | 'detached' | 'uninitialized'
  headCommitId: string | null
  headIsMerge: boolean
  onNodeSelect: (node: Record<string, unknown> | null) => void
}

function clearHighlight(cy: cytoscape.Core) {
  cy.elements().removeClass('faded highlighted')
}

function ToolbarButton({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-secondary"
    >
      {children}
    </button>
  )
}

export default function GraphExplorer({
  branchName,
  sessionId,
  workspaceMode,
  headCommitId,
  headIsMerge,
  onNodeSelect,
}: Props) {
  const api = useApi()
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [selectedNode, setSelectedNode] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    const loadGraph = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await api.getBranchGraph(branchName)
        if (!cancelled) {
          setGraphData(data)
          setSelectedNode(null)
          onNodeSelect(null)
        }
      } catch (loadError) {
        if (!cancelled) {
          setGraphData(null)
          setSelectedNode(null)
          onNodeSelect(null)
          setError(loadError instanceof Error ? loadError.message : 'Failed to load graph.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadGraph()

    return () => {
      cancelled = true
    }
  }, [branchName, refreshKey])

  useEffect(() => {
    const filteredGraph = graphData ? filterDemoGraph(graphData) : null

    if (cyRef.current && (!filteredGraph || filteredGraph.nodes.length === 0 || !containerRef.current)) {
      cyRef.current.destroy()
      cyRef.current = null
    }

    if (!containerRef.current || !filteredGraph || filteredGraph.nodes.length === 0) {
      return
    }

    if (cyRef.current) {
      cyRef.current.destroy()
      cyRef.current = null
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements: toCytoscapeElements(filteredGraph),
      style: cytoscapeStyle,
      layout: {
        name: layoutName,
        fit: true,
        padding: 60,
        animate: false,
        randomize: false,
        nodeRepulsion: 10000,
        idealEdgeLength: 120,
      } as cytoscape.LayoutOptions,
    })

    cy.on('tap', 'node', event => {
      const node = event.target
      clearHighlight(cy)
      cy.elements().addClass('faded')
      node.closedNeighborhood().removeClass('faded').addClass('highlighted')
      node.removeClass('faded').addClass('highlighted')

      const data = node.data() as Record<string, unknown>
      setSelectedNode(data)
      onNodeSelect(data)
    })

    cy.on('tap', event => {
      if (event.target === cy) {
        clearHighlight(cy)
        setSelectedNode(null)
        onNodeSelect(null)
      }
    })

    cyRef.current = cy

    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [graphData, onNodeSelect])

  const filteredGraph = graphData ? filterDemoGraph(graphData) : null
  const nodeCount = filteredGraph?.nodes.length ?? 0
  const edgeCount = filteredGraph?.edges.length ?? 0

  return (
    <div className="flex h-full flex-col" style={{ background: '#09090b' }}>
      {/* Graph canvas — takes full space */}
      <div className="relative flex-1 min-h-0">
        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: 'rgba(9,9,11,0.7)' }}>
            <div className="flex items-center gap-3 rounded-xl px-5 py-3.5 text-sm text-text-secondary" style={{ background: '#151519', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
              Loading graph...
            </div>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-8">
            <div className="max-w-sm rounded-xl px-5 py-4 text-sm text-red-300" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
              Failed to load graph
              <div className="mt-1 text-xs text-red-300/60">{error}</div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && nodeCount === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-text-muted">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-20">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="text-xs">No graph data. Start chatting to build the memory graph.</span>
            </div>
          </div>
        )}

        {/* Cytoscape container */}
        <div ref={containerRef} className="h-full w-full" />

        {/* Floating toolbar — top right */}
        <div
          className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg p-1"
          style={{ background: 'rgba(15,15,19,0.85)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}
        >
          <ToolbarButton onClick={() => setRefreshKey(prev => prev + 1)} title="Refresh graph">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </ToolbarButton>
          <ToolbarButton onClick={() => cyRef.current?.fit(undefined, 60)} title="Fit to screen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </ToolbarButton>
          <ToolbarButton onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.2)} title="Zoom in">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </ToolbarButton>
          <ToolbarButton onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 0.8)} title="Zoom out">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </ToolbarButton>
        </div>

        {/* Floating stats — top left */}
        <div
          className="absolute left-3 top-3 z-10 flex items-center gap-3 rounded-lg px-3 py-2 text-[11px]"
          style={{ background: 'rgba(15,15,19,0.85)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}
        >
          <span className="font-mono text-emerald-400">{branchName}</span>
          <span className="text-text-muted">{nodeCount} nodes</span>
          <span className="text-text-muted">{edgeCount} edges</span>
          {headIsMerge && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-emerald-300" style={{ background: 'rgba(16,185,129,0.12)' }}>
              merge
            </span>
          )}
        </div>

        {/* Node detail panel */}
        {selectedNode && (
          <div
            className="absolute bottom-3 right-3 z-10 w-72 max-h-[50%] overflow-y-auto rounded-xl p-4"
            style={{ background: 'rgba(21,21,25,0.95)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span
                className="rounded px-2 py-0.5 text-[11px] font-medium"
                style={{
                  color: NODE_COLORS[String(selectedNode.nodeType ?? '')] ?? '#8b5cf6',
                  background: `${NODE_COLORS[String(selectedNode.nodeType ?? '')] ?? '#8b5cf6'}18`,
                }}
              >
                {formatTypeLabel(String(selectedNode.nodeType ?? 'Node'))}
              </span>
              <button
                onClick={() => { setSelectedNode(null); onNodeSelect(null) }}
                className="text-text-muted hover:text-text-secondary"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {Object.entries(selectedNode)
              .filter(([key]) => !['color', 'nodeType', 'label', 'id', 'size', 'shape', 'entityLabel'].includes(key))
              .map(([key, value]) => (
                <div key={key} className="mb-1.5 text-[11px]">
                  <span className="text-text-muted">{key}</span>
                  <span className="ml-1.5 text-text-secondary">{String(value).slice(0, 120)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Legend bar */}
      <div
        className="flex items-center gap-4 px-4 py-2"
        style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: '#0b0b0e' }}
      >
        {GRAPH_LEGEND_ITEMS.map(item => (
          <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: item.color }}
            />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
