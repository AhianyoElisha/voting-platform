'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { formatPesewas } from '@/lib/money'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface TierOption {
  id: string
  name: string
  price: number
  remaining: number | null
}

type Stage =
  | { kind: 'form' }
  | { kind: 'pending'; paymentId: string; amount: number; instructions: string | null }
  | { kind: 'success'; tierName: string; tickets: { id: string; url: string }[] }
  | { kind: 'failed' }

/** Public ticket purchase (PRD 5.4b). The tickets appear once the payment is confirmed server-side. */
export default function TicketBuyForm({ tiers, mockProvider }: { tiers: TierOption[]; mockProvider: boolean }) {
  const { t } = useTranslation()
  const [tierId, setTierId] = useState(tiers[0]?.id ?? '')
  const [quantity, setQuantity] = useState('1')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: 'form' })

  const tier = tiers.find((x) => x.id === tierId) ?? tiers[0]
  const qty = Math.max(0, Math.floor(Number(quantity) || 0))
  const amount = tier ? tier.price * qty : 0

  useEffect(() => {
    if (stage.kind !== 'pending') return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/public/payments/${stage.paymentId}/tickets`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { status: string; tierName?: string; tickets: { id: string; url: string }[] }
        if (cancelled) return
        if (data.status === 'success')
          setStage({ kind: 'success', tierName: data.tierName ?? '', tickets: data.tickets })
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
      const data = await postJson<{ payment: { id: string; amount: number }; instructions: string | null }>(
        '/api/public/tickets/initiate',
        {
          tierId,
          quantity: qty,
          phone,
          email,
          name,
        }
      )
      setStage({
        kind: 'pending',
        paymentId: data.payment.id,
        amount: data.payment.amount,
        instructions: data.instructions,
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

  if (tiers.length === 0) return null

  if (stage.kind === 'success') {
    return (
      <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-6 dark:border-green-800 dark:bg-green-900/20">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={40} className="mx-auto text-green-600" />
        <p className="text-center font-semibold text-neutral-900 dark:text-white">
          {t('web:tickets.success.title', { count: stage.tickets.length, tier: stage.tierName })}
        </p>
        <p className="text-center text-sm text-neutral-600 dark:text-neutral-300">{t('web:tickets.success.body')}</p>
        <ul className="space-y-2">
          {stage.tickets.map((tk, i) => (
            <li key={tk.id}>
              <Link
                href={tk.url}
                className="block rounded-xl bg-white px-4 py-3 text-sm font-medium text-primary-700 underline dark:bg-neutral-800 dark:text-primary-300"
              >
                {t('web:tickets.success.ticketLink', { n: i + 1 })}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (stage.kind === 'failed') {
    return (
      <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
        <p className="font-semibold text-red-700 dark:text-red-300">{t('web:vote.failed.title')}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('web:tickets.failed.body')}</p>
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
        <p className="text-xs text-neutral-500">{t('web:vote.pending.waiting')}</p>
        {mockProvider && (
          <div className="flex justify-center gap-2 rounded-xl border border-dashed border-amber-400 p-3">
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
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t('web:tickets.form.tier')}
          <select value={tierId} onChange={(e) => setTierId(e.target.value)} className={`${inputClass} mt-1`}>
            {tiers.map((x) => (
              <option key={x.id} value={x.id} disabled={x.remaining !== null && x.remaining <= 0}>
                {x.name} · {formatPesewas(x.price)}
                {x.remaining !== null && x.remaining <= 0 ? ` · ${t('web:tickets.form.soldOut')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t('web:tickets.form.quantity')}
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t('web:tickets.form.name')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t('web:tickets.form.phone')}
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            className={`${inputClass} mt-1`}
            placeholder="024 123 4567"
          />
        </label>
        <label className="text-sm font-medium text-neutral-700 sm:col-span-2 dark:text-neutral-300">
          {t('web:tickets.form.email')}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} mt-1`}
          />
          <span className="mt-1 block text-xs font-normal text-neutral-500 dark:text-neutral-400">
            {t('web:tickets.form.emailHelper')}
          </span>
        </label>
      </div>
      <div className="flex items-center justify-between rounded-xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">
        <span className="text-neutral-600 dark:text-neutral-300">{t('web:vote.form.total')}</span>
        <span className="font-semibold text-neutral-900 dark:text-white">{formatPesewas(amount)}</span>
      </div>
      <button
        type="submit"
        disabled={busy || qty < 1 || !tier}
        className="w-full rounded-xl bg-primary-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
      >
        {busy ? t('web:vote.form.submitting') : t('web:vote.form.submit', { amount: formatPesewas(amount) })}
      </button>
    </form>
  )
}
