'use client'

import { inputClass } from '@/components/organization/OrganizationFields'
import { useState } from 'react'

/**
 * A phone-shaped walk through the USSD menu, for development and demos. It
 * talks to the handler through /api/dev/ussd, so what you see is what a
 * caller would see once Hubtel's shortcode is live.
 */
export default function UssdSimulator() {
  const [phone, setPhone] = useState('0241234567')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [screen, setScreen] = useState('Dial to start.')
  const [input, setInput] = useState('')
  const [ended, setEnded] = useState(true)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const send = async (type: 'initiation' | 'response', text: string) => {
    const id = type === 'initiation' ? `sim_${Date.now()}` : sessionId
    if (!id) return
    setBusy(true)
    try {
      const res = await fetch('/api/dev/ussd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: id, phone, text, type }),
      })
      const data = (await res.json()) as { message: string; end: boolean }
      setSessionId(id)
      setScreen(data.message)
      setEnded(data.end)
      setLog((l) => [...l, `> ${type === 'initiation' ? '*dial*' : text}`, data.message])
      setInput('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Phone (the dialling number)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <div className="rounded-3xl border-4 border-neutral-800 bg-neutral-900 p-4 text-green-300 shadow-lg">
          <pre className="min-h-40 font-mono text-sm whitespace-pre-wrap">{screen}</pre>
          {!ended && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void send('response', input)
              }}
              className="mt-3 flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoFocus
                className="w-full rounded-lg bg-neutral-800 px-3 py-2 font-mono text-sm text-white"
                aria-label="Reply"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Send
              </button>
            </form>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send('initiation', '')}
          className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {ended ? 'Dial' : 'Hang up and dial again'}
        </button>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">Transcript</p>
        <pre className="max-h-96 overflow-auto rounded-xl bg-neutral-100 p-3 font-mono text-xs whitespace-pre-wrap text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
          {log.join('\n') || '—'}
        </pre>
      </div>
    </div>
  )
}
