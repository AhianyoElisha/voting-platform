'use client'

import { inputClass } from '@/components/organization/OrganizationFields'
import { account } from '@/lib/appwrite'
import { recoveryUrl, requestOutcome } from '@/lib/password-recovery'
import { Mail01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Asks Appwrite to email a reset link (`src/lib/password-recovery.ts`). */
export default function ForgotPasswordForm() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const address = email.trim()
    let outcome: ReturnType<typeof requestOutcome>
    try {
      await account.createRecovery(address, recoveryUrl(window.location.origin))
      outcome = 'sent'
    } catch (err) {
      outcome = requestOutcome(err)
    }
    setBusy(false)
    if (outcome === 'sent') setSentTo(address)
    else setError(t(`errors:auth.${outcome}`))
  }

  if (sentTo) {
    return (
      <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-900/20">
        <HugeiconsIcon icon={Mail01Icon} size={40} className="mx-auto text-green-600" />
        <p className="font-semibold text-neutral-900 dark:text-white">{t('web:forgotPassword.sent.title')}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {t('web:forgotPassword.sent.body', { email: sentTo })}
        </p>
        <button
          type="button"
          onClick={() => setSentTo(null)}
          className="text-sm font-medium text-neutral-700 underline dark:text-neutral-300"
        >
          {t('web:forgotPassword.sent.again')}
        </button>
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
      <div>
        <label htmlFor="forgot-email" className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t('auth:field.email.label')}
        </label>
        <input
          id="forgot-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          placeholder={t('auth:field.email.placeholder')}
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-primary-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
      >
        {busy ? t('web:forgotPassword.submitting') : t('web:forgotPassword.submit')}
      </button>
      <div className="text-center">
        <Link href="/login" className="text-sm text-neutral-500 underline hover:text-neutral-700 dark:text-neutral-400">
          {t('web:forgotPassword.backToLogin')}
        </Link>
      </div>
    </form>
  )
}
