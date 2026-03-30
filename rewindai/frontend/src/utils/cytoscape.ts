import type { GraphData } from '../types'

export const NODE_COLORS: Record<string, string> = {
  decision: '#8b5cf6',
  fact: '#3b82f6',
  action_item: '#f97316',
  question: '#eab308',
  context: '#64748b',
  Commit: '#10b981',
  Branch: '#f43f5e',
  CompactionSnapshot: '#6366f1',
  Session: '#06b6d4',
  Memory: '#8b5cf6',
}

export const EDGE_COLORS: Record<string, string> = {
  DEPENDS_ON: '#a78bfa',
  SUPERSEDES: '#ef4444',
  PARENT_OF: '#10b981',
  BRANCHED_FROM: '#f43f5e',
  ON_BRANCH: '#64748b',
  AUTHORED_BY: '#06b6d4',
  IN_SESSION: '#64748b',
}

export function graphDataToCytoscape(data: GraphData) {
  const elements: Array<{ data: Record<string, unknown>; classes?: string }> = []

  for (const node of data.nodes) {
    const nodeType = node.type || node.label || 'default'
    elements.push({
      data: {
        id: node.id,
        label: (node.properties as Record<string, unknown>)?.content
          ? String((node.properties as Record<string, unknown>).content).slice(0, 40)
          : node.id.slice(0, 8),
        nodeType,
        ...node.properties,
      },
      classes: nodeType,
    })
  }

  for (const edge of data.edges) {
    elements.push({
      data: {
        id: `${edge.source}-${edge.relationship}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        label: edge.relationship,
        edgeType: edge.relationship,
      },
      classes: edge.relationship,
    })
  }

  return elements
}

export const cytoscapeStyle = [
  {
    selector: 'node',
    style: {
      'background-color': '#64748b',
      label: 'data(label)',
      color: '#e4e4e7',
      'font-size': '10px',
      'text-valign': 'bottom' as const,
      'text-margin-y': 5,
      width: 30,
      height: 30,
    },
  },
  ...Object.entries(NODE_COLORS).map(([type, color]) => ({
    selector: `.${type}`,
    style: { 'background-color': color },
  })),
  {
    selector: 'edge',
    style: {
      'line-color': '#3f3f5f',
      'target-arrow-color': '#3f3f5f',
      'target-arrow-shape': 'triangle' as const,
      'curve-style': 'bezier' as const,
      label: 'data(label)',
      'font-size': '8px',
      color: '#71717a',
      width: 1.5,
    },
  },
  ...Object.entries(EDGE_COLORS).map(([type, color]) => ({
    selector: `edge.${type}`,
    style: { 'line-color': color, 'target-arrow-color': color },
  })),
  {
    selector: 'edge.DEPENDS_ON, edge.BRANCHED_FROM',
    style: { 'line-style': 'dashed' as const },
  },
  {
    selector: ':selected',
    style: { 'border-width': 3, 'border-color': '#ffffff' },
  },
]
