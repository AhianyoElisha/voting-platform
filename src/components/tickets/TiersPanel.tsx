'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { formatPesewas } from '@/lib/money'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface TierRow {
  id: string
  name: string
  price: number
  quantityAvailable: number | null
  quantitySold: number
  status: string
}

const btn =
  'rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 border border-neutral-300 dark:border-neutral-600'

export default function TiersPanel({
  orgId,
  eventId,
  tiers,
  canManage,
}: {
  orgId: string
  eventId: string
  tiers: TierRow[]
  canManage: boolean
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const base = `/api/orgs/${orgId}/events/${eventId}/tiers`

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }

  const create = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await postJson(base, { name, priceCedis: price, quantityAvailable: quantity === '' ? null : Number(quantity) })
      setName('')
      setPrice('')
      setQuantity('')
    })
  }

  return (
    <div className="space-y-3">
      {tiers.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:tickets.panel.empty')}</p>
      ) : (
        <ul className="divide-y divide-neutral-200 overflow-hidden surface dark:divide-neutral-700">
          {tiers.map((tier) => (
            <li key={tier.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <span className="font-medium text-neutral-900 dark:text-white">{tier.name}</span>
                <span className="ml-2 text-neutral-600 dark:text-neutral-300">{formatPesewas(tier.price)}</span>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {tier.quantityAvailable === null
                    ? t('web:tickets.panel.soldUnlimited', { sold: tier.quantitySold })
                    : t('web:tickets.panel.soldOf', { sold: tier.quantitySold, total: tier.quantityAvailable })}
                  {tier.status === 'hidden' ? ` · ${t('web:tickets.panel.hidden')}` : ''}
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      postJson(
                        `${base}/${tier.id}`,
                        { status: tier.status === 'hidden' ? 'active' : 'hidden' },
                        'PATCH'
                      )
                    )
                  }
                  className={btn}
                >
                  {tier.status === 'hidden' ? t('web:tickets.panel.show') : t('web:tickets.panel.hide')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={create} className="flex flex-wrap items-end gap-2 text-xs">
          <label>
            {t('web:tickets.panel.name')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              className={`${inputClass} py-1.5 text-xs`}
              placeholder="Regular"
            />
          </label>
          <label>
            {t('web:tickets.panel.price')}
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              className={`${inputClass} w-28 py-1.5 text-xs`}
              placeholder="50.00"
            />
          </label>
          <label>
            {t('web:tickets.panel.quantity')}
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="numeric"
              pattern="\d*"
              className={`${inputClass} w-28 py-1.5 text-xs`}
              placeholder={t('web:tickets.panel.unlimited')}
            />
          </label>
          <button type="submit" disabled={busy} className="rounded-lg btn-brand px-3 py-1.5 text-xs font-medium">
            {t('web:tickets.panel.add')}
          </button>
          {error && <span className="text-red-600">{error}</span>}
        </form>
      )}
    </div>
  )
}
