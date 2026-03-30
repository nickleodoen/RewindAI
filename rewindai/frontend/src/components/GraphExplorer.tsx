import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import type { GraphData } from '../types'
import { useApi } from '../hooks/useApi'
import { NODE_COLORS, graphDataToCytoscape, cytoscapeStyle } from '../utils/cytoscape'

interface Props {
  branchName: string
  sessionId: string | null
  onNodeSelect: (node: Record<string, unknown> | null) => void
}

export default function GraphExplorer({ branchName, onNodeSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const api = useApi()

  useEffect(() => {
    api.getBranchGraph(branchName).then(data => {
      setGraphData(data)
    })
  }, [branchName])

  useEffect(() => {
    if (!containerRef.current || !graphData || graphData.nodes.length === 0) return

    const elements = graphDataToCytoscape(graphData)

    if (cyRef.current) {
      cyRef.current.destroy()
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements: elements as any,
      style: cytoscapeStyle as any,
      layout: { name: 'cose', animate: false, padding: 30, nodeRepulsion: () => 8000, idealEdgeLength: () => 80 } as any,
    })

    cy.on('tap', 'node', (e) => {
      const data = e.target.data()
      setSelected(data)
      onNodeSelect(data)
    })

    cy.on('tap', (e) => {
      if (e.target === cy) {
        setSelected(null)
        onNodeSelect(null)
      }
    })

    cyRef.current = cy

    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [graphData, onNodeSelect])

  return (
    <div className="h-full flex flex-col">
      {/* Legend */}
      <div className="flex gap-3 p-3 border-b border-border flex-wrap">
        {Object.entries(NODE_COLORS).filter(([k]) => ['decision', 'fact', 'action_item', 'question', 'context', 'Commit', 'Branch'].includes(k)).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[10px] text-zinc-400">{type.replace('_', ' ')}</span>
          </div>
        ))}
      </div>

      {/* Graph */}
      <div ref={containerRef} className="flex-1" />

      {/* Detail panel */}
      {selected && (
        <div className="border-t border-border p-3 max-h-40 overflow-y-auto">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[selected.nodeType as string] || '#64748b' }} />
            <span className="text-xs font-medium text-zinc-300">{String(selected.nodeType || 'node').replace('_', ' ')}</span>
            <span className="text-[10px] text-zinc-600 ml-auto">{String(selected.id || '').slice(0, 12)}</span>
          </div>
          {selected.content ? <p className="text-xs text-zinc-400">{String(selected.content)}</p> : null}
          {selected.message ? <p className="text-xs text-zinc-400">{String(selected.message)}</p> : null}
          {Array.isArray(selected.tags) && selected.tags.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {(selected.tags as string[]).map(tag => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-surface rounded text-zinc-500">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {(!graphData || graphData.nodes.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-zinc-600 text-sm">No graph data on this branch yet</div>
        </div>
      )}
    </div>
  )
}
