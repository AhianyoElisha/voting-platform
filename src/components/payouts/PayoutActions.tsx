'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const btn = 'rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50'

/** Organizer: cancel a pending request. Super admin: approve, reject, mark paid. */
export function CancelPayoutButton({ orgId, payoutId }: { orgId: string; payoutId: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            const res = await fetch(`/api/orgs/${orgId}/payouts/${payoutId}`, { method: 'DELETE' })
            if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'failed')
            router.refresh()
          } catch (err) {
            setError(err instanceof Error ? err.message : t('errors:auth.unknown'))
          } finally {
            setBusy(false)
          }
        }}
        className={`${btn} border border-neutral-300 dark:border-neutral-600`}
      >
        {t('web:payouts.cancel')}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}

export function AdminPayoutActions({ payoutId, status }: { payoutId: string; status: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const act = async (action: 'approve' | 'reject' | 'paid') => {
    if (action === 'paid' && !window.confirm(t('web:admin.payouts.paidConfirm'))) return
    setBusy(true)
    setError('')
    try {
      await postJson(`/api/admin/payouts/${payoutId}`, { action, note }, 'PATCH')
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        className="rounded-lg border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-600 dark:bg-neutral-800"
        placeholder={t('web:admin.payouts.note')}
        aria-label={t('web:admin.payouts.note')}
      />
      {status === 'requested' && (
        <>
          <button type="button" disabled={busy} onClick={() => void act('approve')} className={`${btn} btn-brand`}>
            {t('web:admin.payouts.approve')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act('reject')}
            className={`${btn} border border-red-300 text-red-700 dark:border-red-700 dark:text-red-300`}
          >
            {t('web:admin.payouts.reject')}
          </button>
        </>
      )}
      {status === 'approved' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void act('paid')}
          className={`${btn} bg-green-600 text-white`}
        >
          {t('web:admin.payouts.markPaid')}
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
