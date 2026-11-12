'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { compressImage } from '@/utils/compressImage'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

const small = 'rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50'

/**
 * Organizer edits to one nominee: name, portal email, bio and photo. The
 * photo is for nominees who will not use the portal; uploading it regenerates
 * the flyer. Once the nominee has claimed the portal, the email is their
 * login and is shown read-only.
 */
export default function NomineeEditControl({
  orgId,
  eventId,
  nominee,
}: {
  orgId: string
  eventId: string
  nominee: { id: string; name: string; email: string | null; bio: string | null; claimed: boolean; hasPhoto: boolean }
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(nominee.name)
  const [email, setEmail] = useState(nominee.email ?? '')
  const [bio, setBio] = useState(nominee.bio ?? '')
  const [file, setFile] = useState<File | null>(null)
  // Remounts the file input after an upload so it no longer shows the sent file.
  const [inputKey, setInputKey] = useState(0)
  const [busy, setBusy] = useState<'' | 'save' | 'photo'>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const base = `/api/orgs/${orgId}/events/${eventId}/nominees/${nominee.id}`

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('save')
    setError('')
    setNotice('')
    try {
      const body: Record<string, string> = { name, bio }
      if (!nominee.claimed) body.email = email
      await postJson(base, body, 'PATCH')
      setNotice(t('web:events.nominees.edit.saved'))
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy('')
    }
  }

  const upload = async () => {
    if (!file) return
    setBusy('photo')
    setError('')
    setNotice('')
    try {
      const compressed = await compressImage(file, { maxDimension: 1600, quality: 0.85, maxSizeKB: 1500 })
      const form = new FormData()
      form.append('photo', compressed, compressed.name || 'photo.jpg')
      const res = await fetch(`${base}/photo`, { method: 'POST', body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? t('errors:photo.failed'))
      setFile(null)
      setInputKey((k) => k + 1)
      setNotice(t('web:events.nominees.edit.photoSaved'))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors:photo.failed'))
    } finally {
      setBusy('')
    }
  }

  if (!open) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`${small} border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700`}
        >
          {t('web:events.nominees.edit.open')}
        </button>
        {notice && <p className="text-xs text-green-600">{notice}</p>}
      </div>
    )
  }

  return (
    <div className="max-w-xs space-y-3 rounded-lg border border-neutral-300 p-2 text-xs dark:border-neutral-600">
      <form onSubmit={save} className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
          className={`${inputClass} py-1.5 text-xs`}
          aria-label={t('web:events.nominees.name')}
          placeholder={t('web:events.nominees.namePlaceholder')}
        />
        {nominee.claimed ? (
          <p className="text-neutral-500 dark:text-neutral-400">
            {nominee.email} · {t('web:events.nominees.edit.emailLocked')}
          </p>
        ) : (
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} py-1.5 text-xs`}
            aria-label={t('web:events.nominees.emailPlaceholder')}
            placeholder={t('web:events.nominees.emailPlaceholder')}
          />
        )}
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={2000}
          rows={2}
          className={`${inputClass} py-1.5 text-xs`}
          aria-label={t('web:events.nominees.bioPlaceholder')}
          placeholder={t('web:events.nominees.bioPlaceholder')}
        />
        <div className="flex gap-2">
          <button type="submit" disabled={busy !== ''} className={`${small} bg-primary-600 text-white`}>
            {busy === 'save' ? t('web:events.nominees.edit.saving') : t('web:events.nominees.edit.save')}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={`${small} border border-neutral-300 dark:border-neutral-600`}
          >
            {t('web:events.nominees.edit.close')}
          </button>
        </div>
      </form>

      <div className="space-y-1 border-t border-neutral-200 pt-2 dark:border-neutral-700">
        <p className="font-medium text-neutral-700 dark:text-neutral-200">{t('web:events.nominees.edit.photo')}</p>
        <input
          key={inputKey}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-neutral-600 file:mr-2 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-2 file:py-1 dark:text-neutral-300 dark:file:bg-neutral-700"
          aria-label={t('web:events.nominees.edit.photo')}
        />
        <button
          type="button"
          disabled={!file || busy !== ''}
          onClick={() => void upload()}
          className={`${small} border border-neutral-300 dark:border-neutral-600`}
        >
          {busy === 'photo'
            ? t('web:events.nominees.edit.uploading')
            : nominee.hasPhoto
              ? t('web:events.nominees.edit.replacePhoto')
              : t('web:events.nominees.edit.uploadPhoto')}
        </button>
      </div>

      {notice && <p className="text-green-600">{notice}</p>}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  )
}
