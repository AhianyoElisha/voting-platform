'use client'

import { buttonClass, fieldClass } from '@/components/admin/ui'
import { apiErrorMessage, postJson } from '@/components/events/api'
import { Switch } from '@/shared/switch'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Settings = {
  status: 'active' | 'suspended'
  commissionRate: number | null
  moraleCandidatesEnabled: boolean
  freeVotesEnabled: boolean
}

/** Percent text ("7.5") to basis points, or null for the platform rate; undefined when invalid. */
function toBps(text: string): number | null | undefined {
  const s = text.trim()
  if (s === '') return null
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return undefined
  const bps = Math.round(Number(s) * 100)
  return bps <= 10_000 ? bps : undefined
}

/** Super admin controls for one organization (PATCH /api/admin/organizations/[orgId]). */
export default function OrganizationSettingsForm({
  orgId,
  initial,
  platformRate,
}: {
  orgId: string
  initial: Settings
  platformRate: string
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [commission, setCommission] = useState(
    initial.commissionRate === null ? '' : String(initial.commissionRate / 100)
  )
  const [morale, setMorale] = useState(initial.moraleCandidatesEnabled)
  const [freeVotes, setFreeVotes] = useState(initial.freeVotesEnabled)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const send = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await postJson(`/api/admin/organizations/${orgId}`, body, 'PATCH')
      setSaved(true)
      setReason('')
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }

  const saveSettings = (e: FormEvent) => {
    e.preventDefault()
    const bps = toBps(commission)
    if (bps === undefined) {
      setError(t('web:admin.settings.commissionInvalid'))
      return
    }
    void send({
      commissionRate: bps,
      moraleCandidatesEnabled: morale,
      freeVotesEnabled: freeVotes,
      ...(reason.trim() ? { reason } : {}),
    })
  }

  const toggleStatus = () => {
    if (initial.status === 'active') {
      if (!reason.trim()) {
        setError(t('web:admin.settings.reasonRequired'))
        return
      }
      if (!window.confirm(t('web:admin.settings.suspendConfirm'))) return
      void send({ status: 'suspended', reason })
    } else {
      void send({ status: 'active', ...(reason.trim() ? { reason } : {}) })
    }
  }

  return (
    <form onSubmit={saveSettings} className="space-y-5 surface p-4">
      <h2 className="font-semibold text-neutral-900 dark:text-white">{t('web:admin.settings.title')}</h2>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-sm text-green-700 dark:text-green-400">{t('web:admin.settings.saved')}</p>}

      <label className="block space-y-1 text-sm">
        <span className="font-medium text-neutral-800 dark:text-neutral-200">{t('web:admin.settings.commission')}</span>
        <span className="flex items-center gap-2">
          <input
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            inputMode="decimal"
            placeholder={platformRate}
            className={`${fieldClass} w-28`}
          />
          <span>%</span>
        </span>
        <span className="block text-xs text-neutral-500">
          {t('web:admin.settings.commissionHelper', { rate: platformRate })}
        </span>
      </label>

      <div className="space-y-3 text-sm">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="font-medium text-neutral-800 dark:text-neutral-200">{t('web:admin.settings.morale')}</span>
            <span className="block text-xs text-neutral-500">{t('web:admin.settings.switchHelper')}</span>
          </span>
          <Switch checked={morale} onChange={setMorale} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">
            {t('web:admin.settings.freeVotes')}
          </span>
          <Switch checked={freeVotes} onChange={setFreeVotes} />
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="font-medium text-neutral-800 dark:text-neutral-200">{t('web:admin.settings.reason')}</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder={t('web:admin.settings.reasonPlaceholder')}
          className={`${fieldClass} w-full`}
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className={buttonClass}>
          {t('web:admin.settings.save')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={toggleStatus}
          className={
            initial.status === 'active'
              ? 'rounded-xl border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20'
              : 'rounded-xl border border-green-300 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 dark:border-green-800 dark:text-green-400'
          }
        >
          {initial.status === 'active' ? t('web:admin.settings.suspend') : t('web:admin.settings.reactivate')}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        {initial.status === 'active' ? t('web:admin.settings.suspendHelper') : t('web:admin.settings.reactivateHelper')}
      </p>
    </form>
  )
}
