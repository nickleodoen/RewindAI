import type { Memory } from '../types'

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'been', 'from', 'have', 'that', 'their', 'there',
  'they', 'this', 'what', 'when', 'where', 'which', 'with', 'would', 'your',
  'into', 'than', 'them', 'then', 'were', 'will', 'just', 'some', 'made',
])

function tokenize(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map(token => token.trim())
        .filter(token => token.length > 2 && !STOP_WORDS.has(token)),
    ),
  )
}

function sortByRecency(memories: Memory[]) {
  return [...memories].sort((left, right) => {
    const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0
    const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0
    return rightTime - leftTime
  })
}

function scoreMemory(memory: Memory, tokens: string[]) {
  const haystack = `${memory.type} ${memory.content} ${memory.tags.join(' ')}`.toLowerCase()
  let score = 0

  tokens.forEach(token => {
    if (memory.type.toLowerCase().includes(token)) {
      score += 4
    }
    if (memory.tags.some(tag => tag.toLowerCase().includes(token))) {
      score += 5
    }
    if (haystack.includes(token)) {
      score += 2
    }
  })

  if (tokens.includes('decision') && memory.type === 'decision') {
    score += 4
  }
  if (tokens.includes('fact') && memory.type === 'fact') {
    score += 3
  }
  if ((tokens.includes('action') || tokens.includes('todo')) && memory.type === 'action_item') {
    score += 3
  }
  if ((tokens.includes('question') || tokens.includes('open')) && memory.type === 'question') {
    score += 3
  }

  return score
}

function formatType(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

export function isUnavailableAssistantText(text: string) {
  return text.startsWith('[API Error]') || text.startsWith('[Mock]')
}

export function buildDemoFallbackReply(prompt: string, memories: Memory[], branchName: string) {
  const tokens = tokenize(prompt)
  const ranked = sortByRecency(memories)
    .map(memory => ({ memory, score: scoreMemory(memory, tokens) }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      const leftTime = left.memory.created_at ? new Date(left.memory.created_at).getTime() : 0
      const rightTime = right.memory.created_at ? new Date(right.memory.created_at).getTime() : 0
      return rightTime - leftTime
    })

  let selected = ranked
    .filter(entry => entry.score > 0)
    .slice(0, 5)
    .map(entry => entry.memory)

  if (selected.length === 0) {
    const byRecency = sortByRecency(memories)
    const decisions = byRecency.filter(memory => memory.type === 'decision').slice(0, 3)
    const extra = byRecency.find(memory => memory.type === 'action_item' || memory.type === 'question')
    selected = extra ? [...decisions, extra] : decisions
  }

  const lines = selected.length > 0
    ? selected.map(memory => {
      const tags = memory.tags.length > 0 ? ` [${memory.tags.join(', ')}]` : ''
      return `• ${formatType(memory.type)}: ${memory.content}${tags}`
    })
    : ['• No stored memories matched this question yet on the current branch.']

  return {
    notice: 'Live AI is unavailable right now. Showing a memory-based demo fallback.',
    content: `Demo fallback from stored ${branchName} memories.\n\n${lines.join('\n')}`,
  }
}
