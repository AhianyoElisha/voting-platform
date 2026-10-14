'use client'

import { inputClass } from '@/components/organization/OrganizationFields'
import type { CategoryDoc, EventDoc, EventStatus, RoundDoc } from '@/lib/types'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiErrorMessage, postJson } from './api'

const NEXT_STATUSES: Record<EventStatus, EventStatus[]> = {
  draft: ['scheduled', 'live'],
  scheduled: ['draft', 'live'],
  live: ['paused', 'closed'],
  paused: ['live', 'closed'],
  closed: [],
}

const btn = 'rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50'
const btnPrimary = `${btn} bg-primary-600 text-white hover:bg-primary-700`
const btnSecondary = `${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800`
const btnDanger = `${btn} border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/20`

function ErrorBox({ message }: { message: string }) {
  if (!message) return null
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center dark:border-red-800 dark:bg-red-900/20">
      <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
    </div>
  )
}

function useAction() {
  const router = useRouter()
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    setError('')
    setBusy(true)
    try {
      await fn()
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }
  return { error, busy, run, t }
}

export function EventStatusControls({
  orgId,
  event,
  canManage,
}: {
  orgId: string
  event: EventDoc
  canManage: boolean
}) {
  const { error, busy, run, t } = useAction()
  if (!canManage) return null
  const next = NEXT_STATUSES[event.status]
  if (next.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {next.map((status) => (
          <button
            key={status}
            type="button"
            disabled={busy}
            onClick={() => {
              if (status === 'closed' && !window.confirm(t('web:events.status.closeConfirm'))) return
              void run(() => postJson(`/api/orgs/${orgId}/events/${event.$id}`, { status }, 'PATCH'))
            }}
            className={status === 'closed' ? btnDanger : status === 'live' ? btnPrimary : btnSecondary}
          >
            {t(`web:events.status.action.${status}`)}
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
    </div>
  )
}

export function AddCategoryForm({ orgId, eventId }: { orgId: string; eventId: string }) {
  const { error, busy, run, t } = useAction()
  const [name, setName] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await postJson(`/api/orgs/${orgId}/events/${eventId}/categories`, { name })
      setName('')
    })
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          className={inputClass}
          placeholder={t('web:events.categories.placeholder')}
          aria-label={t('web:events.categories.add')}
        />
        <button type="submit" disabled={busy} className={`${btnPrimary} shrink-0`}>
          {t('web:events.categories.add')}
        </button>
      </div>
      <ErrorBox message={error} />
    </form>
  )
}

export function AddNomineeForm({
  orgId,
  event,
  categories,
}: {
  orgId: string
  event: EventDoc
  categories: CategoryDoc[]
}) {
  const { error, busy, run, t } = useAction()
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState(categories[0]?.$id ?? '')
  const [bio, setBio] = useState('')
  const [email, setEmail] = useState('')
  const [isMorale, setIsMorale] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await postJson(`/api/orgs/${orgId}/events/${event.$id}/nominees`, { name, categoryId, bio, email, isMorale })
      setName('')
      setBio('')
      setEmail('')
      setIsMorale(false)
    })
  }
  if (categories.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:events.nominees.needCategory')}</p>
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          className={inputClass}
          placeholder={t('web:events.nominees.namePlaceholder')}
          aria-label={t('web:events.nominees.namePlaceholder')}
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          required
          className={inputClass}
          aria-label={t('web:events.nominees.category')}
        >
          {categories.map((c) => (
            <option key={c.$id} value={c.$id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        maxLength={254}
        autoComplete="off"
        className={inputClass}
        placeholder={t('web:events.nominees.emailPlaceholder')}
        aria-label={t('web:events.nominees.emailPlaceholder')}
      />
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={2}
        maxLength={2000}
        className={inputClass}
        placeholder={t('web:events.nominees.bioPlaceholder')}
      />
      {event.moraleCandidatesEnabled && (
        <label className="flex items-start gap-3 text-sm text-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={isMorale}
            onChange={(e) => setIsMorale(e.target.checked)}
            className="mt-1 rounded border-neutral-300"
          />
          <span>
            {t('web:events.nominees.morale.label')}
            <span className="block text-xs text-neutral-500 dark:text-neutral-400">
              {t('web:events.nominees.morale.helper')}
            </span>
          </span>
        </label>
      )}
      <button type="submit" disabled={busy} className={btnPrimary}>
        {t('web:events.nominees.add')}
      </button>
      <ErrorBox message={error} />
    </form>
  )
}

export function RoundControls({
  orgId,
  eventId,
  rounds,
  canManage,
}: {
  orgId: string
  eventId: string
  rounds: RoundDoc[]
  canManage: boolean
}) {
  const { error, busy, run, t } = useAction()
  const [name, setName] = useState('')
  const base = `/api/orgs/${orgId}/events/${eventId}/rounds`
  const anyLive = rounds.some((r) => r.status === 'live')
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
        {rounds.map((round) => (
          <li key={round.$id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-neutral-900 dark:text-white">{round.name}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {t(`web:events.rounds.status.${round.status}`)}
              </p>
            </div>
            {canManage && round.status === 'pending' && (
              <button
                type="button"
                disabled={busy || anyLive}
                onClick={() => void run(() => postJson(`${base}/${round.$id}`, { status: 'live' }, 'PATCH'))}
                className={btnSecondary}
              >
                {t('web:events.rounds.open')}
              </button>
            )}
            {canManage && round.status === 'live' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t('web:events.rounds.closeConfirm'))) return
                  void run(() => postJson(`${base}/${round.$id}`, { status: 'closed' }, 'PATCH'))
                }}
                className={btnDanger}
              >
                {t('web:events.rounds.close')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await postJson(base, { name })
              setName('')
            })
          }}
          className="flex gap-2"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className={inputClass}
            placeholder={t('web:events.rounds.namePlaceholder')}
            aria-label={t('web:events.rounds.add')}
          />
          <button type="submit" disabled={busy} className={`${btnSecondary} shrink-0`}>
            {t('web:events.rounds.add')}
          </button>
        </form>
      )}
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('web:events.rounds.advanceNote')}</p>
      <ErrorBox message={error} />
    </div>
  )
}
