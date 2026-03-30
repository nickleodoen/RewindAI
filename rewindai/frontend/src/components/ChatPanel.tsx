import { useEffect, useRef, useState } from 'react'
import type { Message } from '../types'
import { useApi } from '../hooks/useApi'
import { buildDemoFallbackReply, isUnavailableAssistantText } from '../utils/chatFallback'

type ChatItem = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at?: string
  tone?: 'default' | 'warning' | 'compaction'
}

interface Props {
  sessionId: string | null
  branchName: string
  onCommit: (message: string) => void | Promise<void>
}

function toChatItems(rawMessages: Message[]) {
  return rawMessages.map<ChatItem>(message => ({
    id: message.id,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content,
    created_at: message.created_at,
    tone: 'default',
  }))
}

export default function ChatPanel({ sessionId, branchName, onCommit }: Props) {
  const api = useApi()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  useEffect(() => {
    let cancelled = false

    const loadHistory = async () => {
      if (!sessionId) {
        setMessages([])
        setError(null)
        return
      }

      setLoadingHistory(true)
      setError(null)

      try {
        const rawMessages = await api.getMessages(sessionId)
        let items = toChatItems(rawMessages)
        const needsFallback = rawMessages.some(
          message => message.role === 'assistant' && isUnavailableAssistantText(message.content),
        )

        if (needsFallback) {
          const memories = await api.listMemories(branchName)
          items = rawMessages.flatMap<ChatItem>((message, index) => {
            if (message.role === 'assistant' && isUnavailableAssistantText(message.content)) {
              const previousUser = [...rawMessages.slice(0, index)]
                .reverse()
                .find(candidate => candidate.role === 'user')
              const fallback = buildDemoFallbackReply(previousUser?.content ?? '', memories, branchName)

              return [
                {
                  id: `${message.id}-warning`,
                  role: 'system' as const,
                  content: fallback.notice,
                  tone: 'warning' as const,
                },
                {
                  id: message.id,
                  role: 'assistant' as const,
                  content: fallback.content,
                  created_at: message.created_at,
                  tone: 'default' as const,
                },
              ]
            }

            return [{
              id: message.id,
              role: message.role === 'assistant' ? 'assistant' : 'user',
              content: message.content,
              created_at: message.created_at,
              tone: 'default' as const,
            }]
          })
        }

        if (!cancelled) {
          setMessages(items)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load messages.')
          setMessages([])
        }
      } finally {
        if (!cancelled) {
          setLoadingHistory(false)
        }
      }
    }

    void loadHistory()

    return () => {
      cancelled = true
    }
  }, [branchName, sessionId])

  const handleCommit = async () => {
    const message = window.prompt('Commit message', `Checkpoint on ${branchName}`)
    if (!message || !message.trim()) {
      return
    }

    try {
      await onCommit(message.trim())
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : 'Commit failed.')
    }
  }

  const send = async () => {
    if (!sessionId || sending) {
      return
    }

    const text = input.trim()
    if (!text) {
      return
    }

    const userMessage: ChatItem = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
      tone: 'default',
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setSending(true)
    setError(null)

    try {
      const response = await api.sendMessage(sessionId, text, 'demo')
      const additions: ChatItem[] = []

      if (response.notice) {
        additions.push({
          id: `notice-${Date.now()}`,
          role: 'system',
          content: response.notice,
          tone: response.response_mode === 'live' ? 'default' : 'warning',
        })
      }

      if (response.response_mode !== 'live') {
        additions.push({
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.response,
          created_at: new Date().toISOString(),
          tone: 'default',
        })
      } else if (isUnavailableAssistantText(response.response)) {
        const memories = await api.listMemories(branchName)
        const fallback = buildDemoFallbackReply(text, memories, branchName)
        additions.push({
          id: `warning-${Date.now()}`,
          role: 'system',
          content: fallback.notice,
          tone: 'warning',
        })
        additions.push({
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: fallback.content,
          created_at: new Date().toISOString(),
          tone: 'default',
        })
      } else {
        additions.push({
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.response,
          created_at: new Date().toISOString(),
          tone: 'default',
        })
      }

      if (response.compaction_occurred) {
        additions.push({
          id: `compaction-${Date.now()}`,
          role: 'system',
          content: `Context compacted — ${response.memories_extracted} memories extracted`,
          tone: 'compaction',
        })
      }

      setMessages(prev => [...prev, ...additions])
    } catch (sendError) {
      try {
        const memories = await api.listMemories(branchName)
        const fallback = buildDemoFallbackReply(text, memories, branchName)
        setMessages(prev => [
          ...prev,
          {
            id: `warning-${Date.now()}`,
            role: 'system',
            content: fallback.notice,
            tone: 'warning',
          },
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: fallback.content,
            created_at: new Date().toISOString(),
            tone: 'default',
          },
        ])
      } catch {
        setError(sendError instanceof Error ? sendError.message : 'Failed to send message.')
      }
    } finally {
      setSending(false)
    }
  }

  const renderMessage = (message: ChatItem) => {
    if (message.role === 'system') {
      const isCompaction = message.tone === 'compaction'
      return (
        <div key={message.id} className="flex justify-center py-1">
          <div
            className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px]"
            style={{
              background: isCompaction ? 'rgba(139,92,246,0.08)' : 'rgba(245,158,11,0.08)',
              border: `1px solid ${isCompaction ? 'rgba(139,92,246,0.15)' : 'rgba(245,158,11,0.15)'}`,
              color: isCompaction ? '#a78bfa' : '#fbbf24',
            }}
          >
            {isCompaction && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            )}
            {message.content}
          </div>
        </div>
      )
    }

    const isUser = message.role === 'user'

    return (
      <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div
          className="max-w-[75%] rounded-xl px-4 py-3"
          style={{
            background: isUser ? 'rgba(139,92,246,0.1)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isUser ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.06)'}`,
          }}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-widest" style={{ color: isUser ? '#a78bfa' : '#6b6b76' }}>
              {isUser ? 'You' : 'RewindAI'}
            </span>
            {message.created_at && (
              <span className="text-[10px] text-text-muted">
                {new Date(message.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-primary">{message.content}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" style={{ background: '#09090b' }}>
      {/* Chat header */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-xs font-medium text-text-secondary">Chat</span>
          </div>
          <span className="font-mono text-[11px] text-emerald-400">{branchName}</span>
        </div>
        <button
          onClick={handleCommit}
          disabled={!sessionId}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-emerald-400 transition-colors hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          Commit
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {!sessionId && (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <div className="h-4 w-4 animate-spin rounded-full border border-text-muted border-t-accent mb-3" />
            <span className="text-xs">Starting session...</span>
          </div>
        )}

        {sessionId && loadingHistory && (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <div className="h-4 w-4 animate-spin rounded-full border border-text-muted border-t-accent mb-3" />
            <span className="text-xs">Loading conversation...</span>
          </div>
        )}

        {sessionId && !loadingHistory && messages.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-30">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-xs">Send a message to start chatting</span>
          </div>
        )}

        {error && (
          <div className="mx-auto max-w-md rounded-lg px-4 py-3 text-xs text-red-300" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
            {error}
          </div>
        )}

        <div className="space-y-3">
          {messages.map(renderMessage)}
          {sending && (
            <div className="flex justify-start">
              <div
                className="flex items-center gap-2 rounded-xl px-4 py-3 text-xs text-text-muted"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: '300ms' }} />
                </div>
                Thinking...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div
          className="flex items-end gap-2 rounded-xl p-1.5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder={sessionId ? 'Ask about decisions, facts, or branch history...' : 'Starting session...'}
            disabled={!sessionId || sending}
            rows={1}
            className="min-h-[36px] max-h-[120px] flex-1 resize-none border-none bg-transparent px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted outline-none disabled:cursor-not-allowed disabled:opacity-50"
            style={{ fontFamily: 'inherit' }}
          />
          <button
            onClick={() => void send()}
            disabled={!sessionId || sending || input.trim().length === 0}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-muted disabled:opacity-30"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
