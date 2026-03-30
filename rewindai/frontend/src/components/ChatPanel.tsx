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

      if (isUnavailableAssistantText(response.response)) {
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
          content: `⚡ Context compacted — ${response.memories_extracted} memories extracted`,
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
      const style = message.tone === 'compaction'
        ? 'border border-purple-500/30 bg-purple-500/10 text-purple-200'
        : 'border border-amber-500/30 bg-amber-500/10 text-amber-100'

      return (
        <div key={message.id} className="flex justify-center">
          <div className={`max-w-2xl rounded-xl px-4 py-2 text-xs ${style}`}>
            {message.content}
          </div>
        </div>
      )
    }

    const isUser = message.role === 'user'
    const bubbleClass = isUser
      ? 'bg-purple-500/16 border border-purple-500/25 text-purple-100'
      : 'bg-slate-800/80 border border-slate-700 text-slate-100'

    return (
      <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm shadow-sm ${bubbleClass}`}>
          <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-slate-400">
            {isUser ? 'Demo user' : 'RewindAI'}
          </div>
          <div className="whitespace-pre-wrap leading-6">{message.content}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" style={{ background: '#0b0b12' }}>
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Chat</div>
          <div className="mt-1 text-sm text-slate-300">
            Branch <span className="font-mono text-emerald-400">{branchName}</span>
          </div>
        </div>
        <button
          onClick={handleCommit}
          disabled={!sessionId}
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Commit
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {!sessionId && (
          <div className="mt-20 text-center text-sm text-slate-500">Starting session...</div>
        )}

        {sessionId && loadingHistory && (
          <div className="mt-20 text-center text-sm text-slate-500 animate-pulse">Loading chat...</div>
        )}

        {sessionId && !loadingHistory && messages.length === 0 && !error && (
          <div className="mt-20 text-center text-sm text-slate-500">Send a message to start chatting</div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Failed to load chat. Check backend connection.
            <div className="mt-1 text-xs text-red-300/80">{error}</div>
          </div>
        )}

        <div className="space-y-4">
          {messages.map(renderMessage)}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm text-slate-300 animate-pulse">
                Thinking...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-border px-6 py-4">
        <div className="flex gap-3">
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
            rows={2}
            className="min-h-[56px] flex-1 resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            onClick={() => void send()}
            disabled={!sessionId || sending || input.trim().length === 0}
            className="rounded-2xl bg-purple-500 px-5 py-3 text-sm font-medium text-white transition hover:bg-purple-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
