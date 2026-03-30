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
  ON_BRANCH: '#3f3f46',
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
    return truncate(String(properties.content ?? properties.id ?? node.id), 32)
  }

  if (node.label === 'Commit') {
    if (isMergeCommit(node)) {
      return truncate(String(properties.message ?? `Merge ${properties.mergedFromBranch ?? 'branch'}`), 32)
    }
    return truncate(String(properties.message ?? properties.id ?? node.id), 30)
  }

  if (node.label === 'Branch') {
    return String(properties.name ?? node.id)
  }

  return truncate(String(properties.name ?? properties.id ?? node.id), 20)
}

function isMergeCommit(node: GraphNode) {
  const properties = node.properties ?? {}
  const parentIds = Array.isArray(properties.parentIds) ? properties.parentIds : []
  return Boolean(properties.isMerge) || parentIds.length > 1
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
      const mergeCommit = isMergeCommit(node)
      const shape = node.label === 'Branch'
        ? 'hexagon'
        : node.label === 'Commit'
          ? mergeCommit
            ? 'diamond'
            : 'round-rectangle'
          : 'ellipse'
      const size = node.label === 'Branch' ? 58 : node.label === 'Commit' ? (mergeCommit ? 54 : 46) : 32

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
        classes: node.label === 'Memory'
          ? `memory ${visualType}`
          : mergeCommit
            ? `${node.label} merge-commit`
            : node.label,
      }
    }),
    ...filtered.edges.map((edge, index) => ({
      data: {
        id: `edge-${index}`,
        source: edge.source,
        target: edge.target,
        label: edge.relationship,
        relationship: edge.relationship,
        color: EDGE_COLORS[edge.relationship] ?? '#2a2a35',
      },
      classes: edge.relationship,
    })),
  ]
}

export const GRAPH_LEGEND_ITEMS = [
  { label: 'Decision', color: MEMORY_TYPE_COLORS.decision },
  { label: 'Fact', color: MEMORY_TYPE_COLORS.fact },
  { label: 'Action', color: MEMORY_TYPE_COLORS.action_item },
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
      color: '#d4d4d8',
      'font-family': 'Inter, system-ui, sans-serif',
      'font-size': '9px',
      'font-weight': 500,
      'text-wrap': 'wrap',
      'text-max-width': '100px',
      'text-valign': 'bottom',
      'text-margin-y': 7,
      'text-halign': 'center',
      'text-background-color': '#09090b',
      'text-background-opacity': 0.75,
      'text-background-padding': '2px',
      'overlay-padding': '4px',
      'overlay-opacity': 0,
      width: 'data(size)',
      height: 'data(size)',
      shape: 'data(shape)',
      'border-width': 1,
      'border-color': 'rgba(255,255,255,0.08)',
      'background-opacity': 0.85,
    },
  },
  {
    selector: 'edge',
    style: {
      'line-color': 'data(color)',
      'target-arrow-color': 'data(color)',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.7,
      'curve-style': 'bezier',
      label: 'data(label)',
      color: '#52525b',
      'font-family': 'Inter, system-ui, sans-serif',
      'font-size': '7px',
      'text-background-color': '#09090b',
      'text-background-opacity': 0.85,
      'text-background-padding': '2px',
      width: 1.5,
      'line-opacity': 0.6,
    },
  },
  {
    selector: '.highlighted',
    style: {
      opacity: 1,
      'border-width': 2.5,
      'border-color': '#f0f0f3',
      'background-opacity': 1,
      'line-opacity': 1,
    },
  },
  {
    selector: '.merge-commit',
    style: {
      'border-width': 2.5,
      'border-color': '#f0f0f3',
      'background-color': '#22c55e',
      'background-opacity': 1,
      'font-weight': 700,
    },
  },
  {
    selector: 'edge.highlighted',
    style: {
      width: 2.5,
      'line-color': '#a1a1aa',
      'target-arrow-color': '#a1a1aa',
      color: '#d4d4d8',
      'line-opacity': 1,
    },
  },
  {
    selector: '.faded',
    style: {
      opacity: 0.12,
    },
  },
  {
    selector: 'edge.BRANCHED_FROM',
    style: {
      'line-style': 'dashed',
      'line-dash-pattern': [6, 4],
    },
  },
  {
    selector: 'edge.SUPERSEDES',
    style: {
      'line-style': 'dashed',
      'line-dash-pattern': [4, 3],
    },
  },
]
