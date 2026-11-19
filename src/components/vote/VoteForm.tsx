'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import PaymentNotice from '@/components/PaymentNotice'
import OtpEntry from '@/components/vote/OtpEntry'
import { formatPesewas } from '@/lib/money'
import { ArrowRight01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Stage =
  | { kind: 'form' }
  | {
      kind: 'pending'
      paymentId: string
      amount: number
      quantity: number
      instructions: string | null
      needsOtp: boolean
    }
  | { kind: 'success'; quantity: number }
  | { kind: 'failed' }

/**
 * Web vote (PRD 5.3): pick a quantity, enter the MoMo number, approve the
 * prompt. The page only ever learns the payment's status; the vote is counted
 * server-side from the provider's confirmation.
 */
export default function VoteForm({
  code,
  nomineeName,
  votePrice,
  maxQuantity,
  mockProvider,
}: {
  code: string
  nomineeName: string
  votePrice: number
  /** The most votes one payment can buy at this price (decision #16); the server enforces it too. */
  maxQuantity: number
  mockProvider: boolean
}) {
  const { t } = useTranslation()
  const [quantity, setQuantity] = useState('1')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: 'form' })

  const qty = Math.max(0, Math.floor(Number(quantity) || 0))
  const amount = qty * votePrice

  // Poll while the payer approves the prompt.
  useEffect(() => {
    if (stage.kind !== 'pending') return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/public/payments/${stage.paymentId}/status`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { status: string }
        if (cancelled) return
        if (data.status === 'success') setStage({ kind: 'success', quantity: stage.quantity })
        else if (data.status === 'failed') setStage({ kind: 'failed' })
      } catch {
        /* keep polling */
      }
    }
    const id = setInterval(tick, 3000)
    void tick()
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [stage])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const data = await postJson<{
        payment: { id: string; amount: number; quantity: number }
        instructions: string | null
        nextAction: 'otp' | null
      }>('/api/public/votes/initiate', { code, quantity: qty, phone, amount })
      setStage({
        kind: 'pending',
        paymentId: data.payment.id,
        amount: data.payment.amount,
        quantity: data.payment.quantity,
        instructions: data.instructions,
        needsOtp: data.nextAction === 'otp',
      })
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }

  const simulate = async (status: 'success' | 'failed') => {
    if (stage.kind !== 'pending') return
    setBusy(true)
    try {
      await postJson('/api/dev/payments/confirm', { paymentId: stage.paymentId, status })
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }

  if (stage.kind === 'success') {
    return (
      <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-900/20">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={40} className="mx-auto text-green-600" />
        <p className="font-semibold text-neutral-900 dark:text-white">
          {t('web:vote.success.title', { count: stage.quantity, name: nomineeName })}
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('web:vote.success.body')}</p>
        <button
          type="button"
          onClick={() => setStage({ kind: 'form' })}
          className="text-sm font-medium text-primary-600 underline"
        >
          {t('web:vote.success.again')}
        </button>
      </div>
    )
  }

  if (stage.kind === 'failed') {
    return (
      <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
        <p className="font-semibold text-red-700 dark:text-red-300">{t('web:vote.failed.title')}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('web:vote.failed.body')}</p>
        <button
          type="button"
          onClick={() => setStage({ kind: 'form' })}
          className="text-sm font-medium text-primary-600 underline"
        >
          {t('web:vote.failed.retry')}
        </button>
      </div>
    )
  }

  if (stage.kind === 'pending') {
    return (
      <div className="space-y-4 rounded-2xl border border-primary-200 bg-primary-50 p-6 text-center dark:border-primary-800 dark:bg-primary-900/20">
        <p className="font-semibold text-neutral-900 dark:text-white">
          {t('web:vote.pending.title', { amount: formatPesewas(stage.amount) })}
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {stage.instructions ?? t('web:vote.pending.body')}
        </p>
        {stage.needsOtp && (
          <OtpEntry
            paymentId={stage.paymentId}
            onSubmitted={(next) =>
              setStage({ ...stage, instructions: next.instructions, needsOtp: next.nextAction === 'otp' })
            }
          />
        )}
        <p className="text-xs text-neutral-500">{t('web:vote.pending.waiting')}</p>
        {mockProvider && (
          <div className="space-y-2 rounded-xl border border-dashed border-amber-400 p-3 text-left">
            <p className="text-xs font-semibold text-amber-700 uppercase dark:text-amber-300">
              {t('web:vote.dev.title')}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void simulate('success')}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {t('web:vote.dev.approve')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void simulate('failed')}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {t('web:vote.dev.decline')}
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
      <div>
        <label htmlFor="vote-qty" className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t('web:vote.form.quantity')}
        </label>
        <input
          id="vote-qty"
          type="number"
          min={1}
          max={maxQuantity}
          step={1}
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
          className={inputClass}
        />
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {t('web:vote.form.maxHelper', { count: maxQuantity })}
        </p>
      </div>
      <div>
        <label htmlFor="vote-phone" className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t('web:vote.form.phone')}
        </label>
        <input
          id="vote-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          className={inputClass}
          placeholder="024 123 4567"
        />
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('web:vote.form.phoneHelper')}</p>
        <PaymentNotice />
      </div>
      <div className="flex items-center justify-between rounded-xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">
        <span className="text-neutral-600 dark:text-neutral-300">{t('web:vote.form.total')}</span>
        <span className="font-semibold text-neutral-900 dark:text-white">{formatPesewas(amount)}</span>
      </div>
      <button
        type="submit"
        disabled={busy || qty < 1}
        className="flex w-full items-center justify-center gap-2 rounded-xl btn-brand px-4 py-3 text-sm font-medium disabled:opacity-50"
      >
        {busy ? t('web:vote.form.submitting') : t('web:vote.form.submit', { amount: formatPesewas(amount) })}
        {!busy && <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.5} />}
      </button>
    </form>
  )
}
