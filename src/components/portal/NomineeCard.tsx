'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { compressImage } from '@/utils/compressImage'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface PortalEntryView {
  id: string
  name: string
  code: string
  bio: string | null
  photoUrl: string | null
  profileCompletedAt: string | null
  flyerUrl: string | null
  event: { title: string; slug: string; status: string } | null
  category: { name: string } | null
  organizationSlug: string | null
}

const btn = 'rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50'

/** One nomination: code, profile form, photo upload and the flyer placeholder. */
export default function NomineeCard({ entry }: { entry: PortalEntryView }) {
  const { t } = useTranslation()
  const router = useRouter()
  const [name, setName] = useState(entry.name)
  const [bio, setBio] = useState(entry.bio ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    setSaved(false)
    try {
      await postJson(`/api/portal/nominees/${entry.id}`, { name, bio }, 'PATCH')
      setSaved(true)
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setSaving(false)
    }
  }

  const uploadPhoto = async (e: FormEvent) => {
    e.preventDefault()
    if (!file) return
    setError('')
    setUploading(true)
    try {
      // Shrink on the phone first (pickLT's helper); the server re-encodes anyway.
      const compressed = await compressImage(file, { maxDimension: 1600, quality: 0.85, maxSizeKB: 1500 })
      const form = new FormData()
      form.append('photo', compressed, compressed.name || 'photo.jpg')
      const res = await fetch(`/api/portal/nominees/${entry.id}/photo`, { method: 'POST', body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? t('errors:photo.failed'))
      setFile(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors:photo.failed'))
    } finally {
      setUploading(false)
    }
  }

  const publicHref =
    entry.organizationSlug && entry.event ? `/o/${entry.organizationSlug}/${entry.event.slug}/vote/${entry.code}` : null

  return (
    <article className="space-y-6 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {entry.event?.title ?? ''}
            {entry.category ? ` · ${entry.category.name}` : ''}
          </p>
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{entry.name}</h2>
        </div>
        <div className="rounded-xl bg-primary-50 px-4 py-2 text-center dark:bg-primary-900/20">
          <p className="text-xs text-neutral-500 uppercase dark:text-neutral-400">{t('web:portal.card.code')}</p>
          <p className="font-mono text-2xl font-bold text-primary-700 dark:text-primary-300">{entry.code}</p>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-3">
          <h3 className="font-medium text-neutral-900 dark:text-white">{t('web:portal.photo.title')}</h3>
          {entry.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.photoUrl}
              alt={entry.name}
              className="aspect-square w-full max-w-xs rounded-2xl object-cover"
            />
          ) : (
            <div className="flex aspect-square w-full max-w-xs items-center justify-center rounded-2xl bg-neutral-100 text-sm text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
              {t('web:portal.photo.helper')}
            </div>
          )}
          <form onSubmit={uploadPhoto} className="space-y-2">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm dark:text-neutral-300 dark:file:bg-neutral-700"
              aria-label={t('web:portal.photo.choose')}
            />
            <button
              type="submit"
              disabled={!file || uploading}
              className={`${btn} bg-primary-600 text-white hover:bg-primary-700`}
            >
              {uploading
                ? t('web:portal.photo.uploading')
                : entry.photoUrl
                  ? t('web:portal.photo.replace')
                  : t('web:portal.photo.upload')}
            </button>
          </form>
        </section>

        <section className="space-y-3">
          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <label
                htmlFor={`name-${entry.id}`}
                className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                {t('web:portal.profile.name')}
              </label>
              <input
                id={`name-${entry.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor={`bio-${entry.id}`}
                className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                {t('web:portal.profile.bio')}
              </label>
              <textarea
                id={`bio-${entry.id}`}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                maxLength={2000}
                className={inputClass}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className={`${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700`}
              >
                {saving ? t('web:portal.profile.saving') : t('web:portal.profile.save')}
              </button>
              {saved && <span className="text-sm text-green-600">{t('web:portal.profile.saved')}</span>}
            </div>
          </form>

          <div className="rounded-xl border border-dashed border-neutral-300 p-4 dark:border-neutral-600">
            <h3 className="font-medium text-neutral-900 dark:text-white">{t('web:portal.flyer.title')}</h3>

            {entry.flyerUrl ? (
              <div className="mt-3 space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}

                <img src={entry.flyerUrl} alt={t('web:portal.flyer.title')} className="w-full max-w-xs rounded-xl" />

                <a
                  href={entry.flyerUrl}
                  download
                  className={`${btn} inline-block bg-primary-600 text-white hover:bg-primary-700`}
                >
                  {t('web:portal.flyer.download')}
                </a>

                <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('web:portal.flyer.share')}</p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                {entry.photoUrl ? t('web:portal.flyer.soon') : t('web:portal.flyer.needPhoto')}
              </p>
            )}
          </div>

          {publicHref && (
            <Link
              href={publicHref}
              className="inline-block text-sm font-medium text-primary-600 underline dark:text-primary-400"
            >
              {t('web:portal.card.publicPage')}
            </Link>
          )}
        </section>
      </div>
    </article>
  )
}
