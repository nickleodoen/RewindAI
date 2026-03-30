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
  onNodeSelect: (node: Record<string, unknown> | null) => void
}

function clearHighlight(cy: cytoscape.Core) {
  cy.elements().removeClass('faded highlighted')
}

export default function GraphExplorer({ branchName, sessionId, onNodeSelect }: Props) {
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
        padding: 50,
        animate: false,
        randomize: false,
        nodeRepulsion: 9000,
        idealEdgeLength: 110,
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
    <div className="flex h-full flex-col" style={{ background: '#0b0b12' }}>
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Memory Graph</div>
          <div className="mt-1 text-sm text-slate-300">
            <span className="font-mono text-emerald-400">{branchName}</span>
            <span className="ml-3 text-slate-500">Session {sessionId ? sessionId.slice(0, 8) : 'starting'}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>{nodeCount} nodes</span>
          <span>{edgeCount} edges</span>
          <button
            onClick={() => setRefreshKey(prev => prev + 1)}
            className="rounded-lg border border-slate-600 px-3 py-2 text-slate-200 transition hover:border-purple-400 hover:text-purple-200"
          >
            Refresh
          </button>
          <button
            onClick={() => cyRef.current?.fit(undefined, 50)}
            className="rounded-lg border border-slate-600 px-3 py-2 text-slate-200 transition hover:border-purple-400 hover:text-purple-200"
          >
            Fit
          </button>
        </div>
      </div>

      <div className="flex-1" style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/10">
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface/90 px-5 py-4 text-sm text-slate-200 shadow-lg">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-400/30 border-t-purple-400" />
              Loading graph...
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-200">
              Failed to load graph. Check backend connection.
              <div className="mt-2 text-xs text-red-300/80">{error}</div>
            </div>
          </div>
        )}

        {!loading && !error && nodeCount === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="rounded-2xl border border-dashed border-border bg-surface/70 px-6 py-5 text-sm text-slate-400">
              No graph data. Start chatting to build your memory graph.
            </div>
          </div>
        )}

        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%', minHeight: '500px' }}
        />

        {selectedNode && (
          <div
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              width: 280,
              background: '#1e1e2e',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: 16,
              zIndex: 10,
              maxHeight: '60%',
              overflowY: 'auto',
              boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: NODE_COLORS[String(selectedNode.nodeType ?? '')] ?? '#8b5cf6',
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              {formatTypeLabel(String(selectedNode.nodeType ?? 'Node'))}
            </div>
            {Object.entries(selectedNode)
              .filter(([key]) => !['color', 'nodeType', 'label', 'id', 'size', 'shape', 'entityLabel'].includes(key))
              .map(([key, value]) => (
                <div key={key} style={{ fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: '#64748b' }}>{key}: </span>
                  <span style={{ color: '#e2e8f0' }}>{String(value).slice(0, 100)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-border px-5 py-3 text-xs text-slate-400">
        {GRAPH_LEGEND_ITEMS.map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
