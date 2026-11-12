'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { useAuth } from '@/context/auth'
import ButtonPrimary from '@/shared/ButtonPrimary'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** The signed-in user's own name. Email and phone are shown by the page, not edited here. */
export default function ProfileForm({ fullName }: { fullName: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const { refreshSession } = useAuth()
  const [name, setName] = useState(fullName)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      await postJson('/api/account/profile', { fullName: name }, 'PATCH')
      setMessage({ ok: true, text: t('web:account.saved') })
      await refreshSession({ background: true })
      router.refresh()
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, t('errors:auth.unknown')) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-neutral-800 dark:text-neutral-200">{t('web:account.name')}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          className={inputClass}
        />
      </label>
      <div className="flex items-center gap-3">
        <ButtonPrimary type="submit" disabled={saving || name.trim() === fullName}>
          {t('web:account.save')}
        </ButtonPrimary>
        {message && (
          <p
            role="status"
            className={`text-sm ${message.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
          >
            {message.text}
          </p>
        )}
      </div>
    </form>
  )
}
