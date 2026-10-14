'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

function newKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Grant free votes to one nominee (PRD 5.4a). A fresh idempotency key per
 * opened form means a double click or a retried request grants once.
 */
export default function FreeVotesControl({
  orgId,
  eventId,
  nomineeId,
  nomineeName,
}: {
  orgId: string
  eventId: string
  nomineeId: string
  nomineeName: string
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(() => newKey())
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const out = await postJson<{ outcome: string; vote: { quantity: number } }>(
        `/api/orgs/${orgId}/events/${eventId}/nominees/${nomineeId}/free-votes`,
        {
          quantity: Number(quantity),
          reason,
          idempotencyKey: key,
        }
      )
      setDone(t('web:freeVotes.done', { count: out.vote.quantity, name: nomineeName }))
      setOpen(false)
      setQuantity('')
      setReason('')
      setKey(newKey())
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300"
        >
          {t('web:freeVotes.grant')}
        </button>
        {done && <p className="text-xs text-green-600">{done}</p>}
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="max-w-xs space-y-2 rounded-lg border border-amber-300 p-2 text-xs dark:border-amber-700"
    >
      <p className="font-medium text-amber-800 dark:text-amber-300">
        {t('web:freeVotes.title', { name: nomineeName })}
      </p>
      <input
        type="number"
        min={1}
        step={1}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        required
        className={`${inputClass} py-1.5 text-xs`}
        placeholder={t('web:freeVotes.quantity')}
        aria-label={t('web:freeVotes.quantity')}
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        minLength={3}
        maxLength={500}
        className={`${inputClass} py-1.5 text-xs`}
        placeholder={t('web:freeVotes.reason')}
        aria-label={t('web:freeVotes.reason')}
      />
      <p className="text-neutral-500 dark:text-neutral-400">{t('web:freeVotes.notice')}</p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-amber-600 px-2.5 py-1 font-medium text-white disabled:opacity-50"
        >
          {busy ? t('web:freeVotes.granting') : t('web:freeVotes.confirm')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-neutral-300 px-2.5 py-1 dark:border-neutral-600"
        >
          {t('web:freeVotes.cancel')}
        </button>
      </div>
      {error && <p className="text-red-600">{error}</p>}
    </form>
  )
}
