import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import type { Memory } from '../types'
import { useApi } from '../hooks/useApi'
import { NODE_COLORS } from '../utils/cytoscape'

interface Props {
  branchName: string
  refreshTrigger: number
}

export default function GraphExplorer({ branchName, refreshTrigger }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [memories, setMemories] = useState<Memory[]>([])
  const [selected, setSelected] = useState<Memory | null>(null)
  const api = useApi()

  useEffect(() => {
    api.listMemories(branchName).then(m => {
      if (m) setMemories(m)
    })
  }, [branchName, refreshTrigger])

  useEffect(() => {
    if (!containerRef.current || memories.length === 0) return

    const elements: cytoscape.ElementDefinition[] = memories.map(m => ({
      data: {
        id: m.id,
        label: m.content.slice(0, 30) + (m.content.length > 30 ? '...' : ''),
        memType: m.type,
      },
      classes: m.type,
    }))

    if (cyRef.current) {
      cyRef.current.destroy()
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#64748b',
            label: 'data(label)',
            color: '#e4e4e7',
            'font-size': '9px',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            width: 24,
            height: 24,
            'text-wrap': 'ellipsis' as any,
            'text-max-width': '80px',
          },
        },
        ...Object.entries(NODE_COLORS).map(([type, color]) => ({
          selector: `.${type}`,
          style: { 'background-color': color } as any,
        })),
        {
          selector: ':selected',
          style: { 'border-width': 3, 'border-color': '#ffffff' } as any,
        },
      ],
      layout: { name: 'cose', animate: false, padding: 30 } as any,
    })

    cy.on('tap', 'node', (e) => {
      const nodeId = e.target.id()
      const mem = memories.find(m => m.id === nodeId)
      setSelected(mem || null)
    })

    cy.on('tap', (e) => {
      if (e.target === cy) setSelected(null)
    })

    cyRef.current = cy

    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [memories])

  return (
    <div className="h-full flex flex-col">
      {/* Legend */}
      <div className="flex gap-3 p-3 border-b border-border flex-wrap">
        {Object.entries(NODE_COLORS).filter(([k]) => ['decision', 'fact', 'action_item', 'question', 'context'].includes(k)).map(([type, color]) => (
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
        <div className="border-t border-border p-3 max-h-32 overflow-y-auto">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[selected.type] || '#64748b' }} />
            <span className="text-xs font-medium text-zinc-300">{selected.type.replace('_', ' ')}</span>
          </div>
          <p className="text-xs text-zinc-400">{selected.content}</p>
          {selected.tags.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {selected.tags.map(tag => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-surface rounded text-zinc-500">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {memories.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-zinc-600 text-sm">No memories on this branch yet</div>
        </div>
      )}
    </div>
  )
}
