'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import BrandBand from '@/components/organization/BrandBand'
import { inputClass } from '@/components/organization/OrganizationFields'
import type { BrandColors } from '@/lib/branding'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

const btn = 'rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50'

/** Name, logo and brand colours (PATCH /api/orgs/[orgId], POST|DELETE /api/orgs/[orgId]/logo). */
export default function OrganizationSettingsForm({
  orgId,
  slug,
  initial,
}: {
  orgId: string
  slug: string
  initial: { name: string; logoUrl: string | null; colors: BrandColors | null }
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [name, setName] = useState(initial.name)
  const [useColors, setUseColors] = useState(initial.colors !== null)
  const [primary, setPrimary] = useState(initial.colors?.primary ?? '#4f46e5')
  const [useAccent, setUseAccent] = useState(!!initial.colors?.accent)
  const [accent, setAccent] = useState(initial.colors?.accent ?? '#f59e0b')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const colors: BrandColors | null = useColors ? { primary, accent: useAccent ? accent : null } : null

  const run = async (done: string, fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await fn()
      setMessage(done)
      router.refresh()
    } catch (err) {
      setError(
        err instanceof Error && !('status' in err) ? err.message : apiErrorMessage(err, t('errors:auth.unknown'))
      )
    } finally {
      setBusy(false)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    void run(t('web:orgSettings.saved'), async () => {
      await postJson(`/api/orgs/${orgId}`, { name, brandColors: colors }, 'PATCH')
    })
  }

  const uploadLogo = (file: File) =>
    run(t('web:orgSettings.logoSaved'), async () => {
      const form = new FormData()
      form.append('logo', file)
      const res = await fetch(`/api/orgs/${orgId}/logo`, { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'upload failed')
    })

  const removeLogo = () =>
    run(t('web:orgSettings.logoRemoved'), async () => {
      const res = await fetch(`/api/orgs/${orgId}/logo`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'failed')
    })

  return (
    <div className="max-w-xl space-y-8">
      {(error || message) && (
        <p className={`text-sm ${error ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
          {error || message}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">{t('web:orgSettings.preview')}</h2>
        <BrandBand name={name || initial.name} logoUrl={initial.logoUrl} colors={colors} />
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('web:orgSettings.previewHelper')}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">{t('web:orgSettings.logo')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${btn} cursor-pointer border border-neutral-300 dark:border-neutral-600`}>
            {initial.logoUrl ? t('web:orgSettings.replaceLogo') : t('web:orgSettings.uploadLogo')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void uploadLogo(f)
              }}
            />
          </label>
          {initial.logoUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void removeLogo()}
              className={`${btn} border border-neutral-300 dark:border-neutral-600`}
            >
              {t('web:orgSettings.removeLogo')}
            </button>
          )}
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('web:orgSettings.logoHelper')}</p>
      </section>

      <form onSubmit={save} className="space-y-5">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">{t('web:orgSettings.details')}</h2>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">{t('web:orgSettings.name')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={120}
            className={inputClass}
          />
        </label>
        <div className="space-y-1 text-sm">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">{t('web:orgSettings.address')}</span>
          <p className="font-mono text-neutral-600 dark:text-neutral-300">/o/{slug}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('web:orgSettings.addressHelper')}</p>
        </div>

        <fieldset className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useColors} onChange={(e) => setUseColors(e.target.checked)} />
            <span className="font-medium text-neutral-800 dark:text-neutral-200">{t('web:orgSettings.useColors')}</span>
          </label>
          {useColors && (
            <div className="flex flex-wrap items-center gap-6 pl-6">
              <label className="flex items-center gap-2">
                <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-9 w-14" />
                {t('web:orgSettings.primary')}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={useAccent} onChange={(e) => setUseAccent(e.target.checked)} />
                <input
                  type="color"
                  value={accent}
                  disabled={!useAccent}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-9 w-14 disabled:opacity-40"
                />
                {t('web:orgSettings.accent')}
              </label>
            </div>
          )}
        </fieldset>

        <button type="submit" disabled={busy} className={`${btn} bg-primary-600 text-white hover:bg-primary-700`}>
          {t('web:orgSettings.save')}
        </button>
      </form>
    </div>
  )
}
