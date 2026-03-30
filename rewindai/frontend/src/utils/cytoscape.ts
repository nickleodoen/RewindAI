import type cytoscape from 'cytoscape'
import type { GraphData, GraphNode, MemoryType } from '../types'

export const MEMORY_TYPE_COLORS: Record<MemoryType, string> = {
  decision: '#8b5cf6',
  fact: '#3b82f6',
  action_item: '#f97316',
  question: '#eab308',
  context: '#64748b',
}

export const NODE_COLORS: Record<string, string> = {
  ...MEMORY_TYPE_COLORS,
  Commit: '#10b981',
  Branch: '#f43f5e',
  Session: '#06b6d4',
  ConversationTurn: '#64748b',
  User: '#94a3b8',
  CompactionSnapshot: '#6366f1',
}

const EDGE_COLORS: Record<string, string> = {
  PARENT_OF: '#10b981',
  BRANCHED_FROM: '#f43f5e',
  SUPERSEDES: '#8b5cf6',
  ON_BRANCH: '#64748b',
}

const DEMO_NODE_LABELS = new Set(['Memory', 'Commit', 'Branch'])

function truncate(text: string, max: number) {
  if (text.length <= max) {
    return text
  }

  return `${text.slice(0, max - 1)}…`
}

export function formatTypeLabel(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function getDisplayLabel(node: GraphNode) {
  const properties = node.properties ?? {}

  if (node.label === 'Memory') {
    return truncate(String(properties.content ?? properties.id ?? node.id), 40)
  }

  if (node.label === 'Commit') {
    return truncate(String(properties.message ?? properties.id ?? node.id), 36)
  }

  if (node.label === 'Branch') {
    return String(properties.name ?? node.id)
  }

  return truncate(String(properties.name ?? properties.id ?? node.id), 24)
}

function getVisualType(node: GraphNode) {
  if (node.label === 'Memory') {
    return String(node.type ?? node.properties.type ?? 'context')
  }

  return node.label ?? node.type ?? 'Unknown'
}

export function filterDemoGraph(data: GraphData) {
  const nodes = (data.nodes ?? []).filter(node => DEMO_NODE_LABELS.has(node.label))
  const nodeIds = new Set(nodes.map(node => node.id))
  const edges = (data.edges ?? []).filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))

  return { nodes, edges }
}

export function toCytoscapeElements(data: GraphData): cytoscape.ElementDefinition[] {
  const filtered = filterDemoGraph(data)

  return [
    ...filtered.nodes.map(node => {
      const visualType = getVisualType(node)
      const color = NODE_COLORS[visualType] ?? '#64748b'
      const shape = node.label === 'Branch'
        ? 'hexagon'
        : node.label === 'Commit'
          ? 'round-rectangle'
          : 'ellipse'
      const size = node.label === 'Branch' ? 62 : node.label === 'Commit' ? 48 : 36

      return {
        data: {
          id: node.id,
          label: getDisplayLabel(node),
          color,
          nodeType: visualType,
          entityLabel: node.label,
          size,
          shape,
          ...node.properties,
        },
        classes: node.label === 'Memory' ? `memory ${visualType}` : node.label,
      }
    }),
    ...filtered.edges.map((edge, index) => ({
      data: {
        id: `edge-${index}`,
        source: edge.source,
        target: edge.target,
        label: edge.relationship,
        relationship: edge.relationship,
        color: EDGE_COLORS[edge.relationship] ?? '#475569',
      },
      classes: edge.relationship,
    })),
  ]
}

export const GRAPH_LEGEND_ITEMS = [
  { label: 'Decision', color: MEMORY_TYPE_COLORS.decision },
  { label: 'Fact', color: MEMORY_TYPE_COLORS.fact },
  { label: 'Action Item', color: MEMORY_TYPE_COLORS.action_item },
  { label: 'Question', color: MEMORY_TYPE_COLORS.question },
  { label: 'Commit', color: NODE_COLORS.Commit },
  { label: 'Branch', color: NODE_COLORS.Branch },
]

export const cytoscapeStyle: Array<{ selector: string; style: Record<string, unknown> }> = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      label: 'data(label)',
      color: '#e2e8f0',
      'font-size': '10px',
      'font-weight': 500,
      'text-wrap': 'wrap',
      'text-max-width': '110px',
      'text-valign': 'bottom',
      'text-margin-y': 8,
      'text-halign': 'center',
      'overlay-padding': '6px',
      'overlay-opacity': 0,
      width: 'data(size)',
      height: 'data(size)',
      shape: 'data(shape)',
      'border-width': 1.5,
      'border-color': '#e2e8f044',
    },
  },
  {
    selector: 'edge',
    style: {
      'line-color': 'data(color)',
      'target-arrow-color': 'data(color)',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      label: 'data(label)',
      color: '#94a3b8',
      'font-size': '8px',
      'text-background-color': '#0f172acc',
      'text-background-opacity': 1,
      'text-background-padding': '2px',
      width: 2,
    },
  },
  {
    selector: '.highlighted',
    style: {
      opacity: 1,
      'border-width': 3,
      'border-color': '#ffffff',
      width: 'mapData(size, 30, 70, 40, 74)',
      height: 'mapData(size, 30, 70, 40, 74)',
    },
  },
  {
    selector: 'edge.highlighted',
    style: {
      width: 3.5,
      'line-color': '#f8fafc',
      'target-arrow-color': '#f8fafc',
      color: '#f8fafc',
    },
  },
  {
    selector: '.faded',
    style: {
      opacity: 0.16,
    },
  },
  {
    selector: 'edge.BRANCHED_FROM',
    style: {
      'line-style': 'dashed',
    },
  },
]
