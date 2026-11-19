'use client'

import { inputClass } from '@/components/organization/OrganizationFields'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiErrorMessage, postJson } from './api'

const btn = 'rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50'
const btnOutline = `${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800`

export interface RoundCandidate {
  id: string
  name: string
  categoryId: string
  /** Where they finished in the last closed round, within their category; absent if they were not in it. */
  previous?: { rank: number; votes: number }
}

/**
 * Setting up a round that has not started (decision #30): the organizer
 * picks which nominees are in it, with their finish in the last closed round
 * beside each name, and may give the round its own price per vote. Both are
 * fixed once the round opens; the server refuses changes after that.
 */
export default function RoundSetup({
  base,
  entrantIds,
  candidates,
  categories,
  priceCedis,
  eventPrice,
  previousRoundName,
}: {
  /** `/api/orgs/{org}/events/{event}/rounds/{round}` */
  base: string
  entrantIds: string[]
  candidates: RoundCandidate[]
  categories: { id: string; name: string }[]
  /** The round's own price as typed in cedis, '' when it uses the event's. */
  priceCedis: string
  /** The event's price, formatted, shown as the default. */
  eventPrice: string
  previousRoundName: string | null
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [picked, setPicked] = useState<Set<string>>(new Set(entrantIds))
  const [price, setPrice] = useState(priceCedis)
  const [busy, setBusy] = useState<'' | 'entrants' | 'price'>('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const savedKey = [...entrantIds].sort().join(',')
  const dirty = [...picked].sort().join(',') !== savedKey

  const run = async (what: 'entrants' | 'price', fn: () => Promise<unknown>, done: string) => {
    setBusy(what)
    setMessage(null)
    try {
      await fn()
      setMessage({ ok: true, text: done })
      router.refresh()
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, t('errors:auth.unknown')) })
    } finally {
      setBusy('')
    }
  }

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const savePrice = (e: FormEvent) => {
    e.preventDefault()
    void run('price', () => postJson(base, { votePriceCedis: price }, 'PATCH'), t('web:events.rounds.setup.priceSaved'))
  }

  return (
    <div className="mt-3 w-full space-y-4 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-900/40">
      <form onSubmit={savePrice} className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-neutral-700 dark:text-neutral-200">
          {t('web:events.rounds.setup.price')}
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder={t('web:events.rounds.setup.pricePlaceholder', { price: eventPrice })}
            className={`${inputClass} mt-1 w-56 py-1.5 text-xs`}
          />
        </label>
        <button type="submit" disabled={busy !== '' || price.trim() === priceCedis} className={btnOutline}>
          {busy === 'price' ? t('web:events.rounds.setup.saving') : t('web:events.rounds.setup.savePrice')}
        </button>
        <p className="w-full text-xs text-neutral-500 dark:text-neutral-400">
          {t('web:events.rounds.setup.priceHelper', { price: eventPrice })}
        </p>
      </form>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-neutral-900 dark:text-white">
            {t('web:events.rounds.setup.pick', { count: picked.size, total: candidates.length })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPicked(new Set(candidates.map((c) => c.id)))}
              className={btnOutline}
            >
              {t('web:events.rounds.setup.all')}
            </button>
            <button type="button" onClick={() => setPicked(new Set())} className={btnOutline}>
              {t('web:events.rounds.setup.none')}
            </button>
          </div>
        </div>
        {previousRoundName && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {t('web:events.rounds.setup.previousHelper', { round: previousRoundName })}
          </p>
        )}
        {candidates.length === 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('web:events.rounds.setup.noNominees')}</p>
        )}
        {categories.map((category) => {
          const rows = candidates
            .filter((c) => c.categoryId === category.id)
            .sort(
              (a, b) =>
                (a.previous?.rank ?? Number.MAX_SAFE_INTEGER) - (b.previous?.rank ?? Number.MAX_SAFE_INTEGER) ||
                a.name.localeCompare(b.name)
            )
          if (rows.length === 0) return null
          return (
            <fieldset key={category.id} className="space-y-1">
              <legend className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">{category.name}</legend>
              {rows.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white dark:hover:bg-neutral-800"
                >
                  <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="flex-1 text-neutral-900 dark:text-white">{c.name}</span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    {c.previous
                      ? t('web:events.rounds.setup.previous', { rank: c.previous.rank, count: c.previous.votes })
                      : previousRoundName
                        ? t('web:events.rounds.setup.notInPrevious')
                        : ''}
                  </span>
                </label>
              ))}
            </fieldset>
          )
        })}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== '' || !dirty}
            onClick={() =>
              void run(
                'entrants',
                () => postJson(`${base}/entrants`, { nomineeIds: [...picked] }, 'PUT'),
                t('web:events.rounds.setup.entrantsSaved')
              )
            }
            className={`${btn} btn-brand`}
          >
            {busy === 'entrants' ? t('web:events.rounds.setup.saving') : t('web:events.rounds.setup.saveEntrants')}
          </button>
          {message && (
            <span role="status" className={`text-xs ${message.ok ? 'text-green-600' : 'text-red-600'}`}>
              {message.text}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
