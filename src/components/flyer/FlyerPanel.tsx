'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface TemplateRow {
  id: string
  name: string
  status: string
  version: number
  categoryName: string | null
  hasBackground: boolean
}

const btn = 'rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50'

/** Organizer's flyer section: templates, bulk generation and the ZIP. */
export default function FlyerPanel({
  orgId,
  orgSlug,
  eventId,
  templates,
  categories,
  generatedCount,
  nomineeCount,
  canDesign,
}: {
  orgId: string
  orgSlug: string
  eventId: string
  templates: TemplateRow[]
  categories: { id: string; name: string }[]
  generatedCount: number
  nomineeCount: number
  canDesign: boolean
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { template } = await postJson<{ template: { id: string } }>(
        `/api/orgs/${orgId}/events/${eventId}/templates`,
        { name, categoryId: categoryId || null }
      )
      router.push(`/dashboard/${orgSlug}/events/${eventId}/flyer/${template.id}`)
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
      setBusy(false)
    }
  }

  const generate = async (force: boolean) => {
    setBusy(true)
    setError('')
    setProgress('')
    try {
      let offset: number | null = 0
      let generated = 0
      let noPhoto = 0
      let total = 0
      while (offset !== null) {
        const batch: {
          total: number
          generated: number
          noPhoto: number
          nextOffset: number | null
          processed: number
        } = await postJson<{
          total: number
          generated: number
          noPhoto: number
          nextOffset: number | null
          processed: number
        }>(`/api/orgs/${orgId}/events/${eventId}/flyers/generate`, { offset, force })
        generated += batch.generated
        noPhoto += batch.noPhoto
        total = batch.total
        offset = batch.nextOffset
        setProgress(t('web:flyer.panel.progress', { done: Math.min(total, (offset ?? total) || total), total }))
      }
      setProgress(t('web:flyer.panel.done', { generated, noPhoto }))
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {templates.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:flyer.panel.empty')}</p>
      ) : (
        <ul className="divide-y divide-neutral-200 overflow-hidden surface dark:divide-neutral-700">
          {templates.map((tpl) => (
            <li key={tpl.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <Link
                  href={`/dashboard/${orgSlug}/events/${eventId}/flyer/${tpl.id}`}
                  className="font-medium text-neutral-900 hover:underline dark:text-white"
                >
                  {tpl.name}
                </Link>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {tpl.categoryName
                    ? t('web:flyer.panel.forCategory', { name: tpl.categoryName })
                    : t('web:flyer.panel.wholeEvent')}{' '}
                  ·{' '}
                  {tpl.status === 'published'
                    ? t('web:flyer.panel.published', { version: tpl.version })
                    : t('web:flyer.panel.draft')}
                  {!tpl.hasBackground ? ` · ${t('web:flyer.panel.noBackground')}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canDesign && (
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            className={`${inputClass} max-w-xs`}
            placeholder={t('web:flyer.panel.namePlaceholder')}
            aria-label={t('web:flyer.panel.create')}
          />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={`${inputClass} w-auto`}
            aria-label={t('web:flyer.panel.scope')}
          >
            <option value="">{t('web:flyer.panel.wholeEvent')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy} className={`${btn} btn-brand`}>
            {t('web:flyer.panel.create')}
          </button>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-neutral-600 dark:text-neutral-300">
          {t('web:flyer.panel.count', { generated: generatedCount, total: nomineeCount })}
        </span>
        {canDesign && templates.some((tpl) => tpl.status === 'published') && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void generate(false)}
              className={`${btn} border border-neutral-300 dark:border-neutral-600`}
            >
              {t('web:flyer.panel.generate')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void generate(true)}
              className={`${btn} border border-neutral-300 dark:border-neutral-600`}
            >
              {t('web:flyer.panel.regenerate')}
            </button>
          </>
        )}
        {generatedCount > 0 && (
          <a
            href={`/api/orgs/${orgId}/events/${eventId}/flyers/zip`}
            className={`${btn} border border-neutral-300 dark:border-neutral-600`}
          >
            {t('web:flyer.panel.zip')}
          </a>
        )}
        {progress && <span className="text-xs text-neutral-500">{progress}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  )
}
