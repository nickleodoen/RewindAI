import { useState, useRef, useEffect } from 'react'
import type { Message } from '../types'
import { useApi } from '../hooks/useApi'

interface Props {
  sessionId: string | null
  branchName: string
  onCommit: (message: string) => void | Promise<void>
}

export default function ChatPanel({ sessionId, branchName, onCommit }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [showCommit, setShowCommit] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const api = useApi()

  useEffect(() => {
    if (sessionId) {
      api.getMessages(sessionId).then(msgs => {
        if (msgs) setMessages(msgs)
      })
    } else {
      setMessages([])
    }
  }, [sessionId])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim() || !sessionId) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setSending(true)

    const res = await api.sendMessage(sessionId, input, 'demo')
    if (res) {
      const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: res.response }
      setMessages(prev => [...prev, assistantMsg])
    }
    setSending(false)
  }

  const handleCommit = async () => {
    const res = await api.createCommit(branchName, commitMsg || 'Checkpoint', 'demo')
    if (res) {
      setShowCommit(false)
      setCommitMsg('')
      await onCommit(commitMsg || 'Checkpoint')
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-zinc-500 text-center mt-20">
            {sessionId ? 'Start chatting...' : 'Create or select a session to begin'}
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
              msg.role === 'user'
                ? 'bg-accent/20 text-purple-200'
                : 'bg-surface text-zinc-300'
            }`}>
              <div className="text-[10px] text-zinc-500 mb-1">
                {msg.role === 'user' ? 'demo' : 'RewindAI'}
              </div>
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-surface rounded-lg px-4 py-2 text-sm text-zinc-500 animate-pulse">
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEnd} />
      </div>

      {/* Commit bar */}
      {showCommit && (
        <div className="border-t border-border px-4 py-2 flex gap-2">
          <input
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder="Commit message..."
            className="flex-1 bg-surface border border-border rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-accent"
            onKeyDown={e => e.key === 'Enter' && handleCommit()}
          />
          <button onClick={handleCommit} className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-500">
            Commit
          </button>
          <button onClick={() => setShowCommit(false)} className="px-3 py-1.5 text-zinc-400 text-sm hover:text-zinc-200">
            Cancel
          </button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border p-4 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={sessionId ? 'Type a message...' : 'No active session'}
          disabled={!sessionId || sending}
          className="flex-1 bg-surface border border-border rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!sessionId || sending || !input.trim()}
          className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-purple-500 disabled:opacity-50"
        >
          Send
        </button>
        <button
          onClick={() => setShowCommit(!showCommit)}
          disabled={!sessionId}
          className="px-3 py-2 bg-emerald-600/20 text-emerald-400 text-sm rounded-lg hover:bg-emerald-600/30 disabled:opacity-50"
          title="Commit current state"
        >
          Commit
        </button>
      </div>
    </div>
  )
}
