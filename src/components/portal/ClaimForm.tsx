'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Claim page form: the token proves the invite; the nominee picks a password. */
export default function ClaimForm({ token }: { token: string }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [doneEmail, setDoneEmail] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError(t('web:portal.claim.mismatch'))
      return
    }
    setBusy(true)
    try {
      const { email } = await postJson<{ email: string }>('/api/portal/claim', { token, password })
      setDoneEmail(email)
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }

  if (doneEmail) {
    return (
      <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-900/20">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={40} className="mx-auto text-green-600" />
        <p className="font-semibold text-neutral-900 dark:text-white">{t('web:portal.claim.done.title')}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {t('web:portal.claim.done.body', { email: doneEmail })}
        </p>
        <Link
          href="/login?redirect=/portal"
          className="inline-block rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          {t('web:portal.claim.done.cta')}
        </Link>
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
        <label htmlFor="claim-pw" className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t('web:portal.claim.password')}
        </label>
        <input
          id="claim-pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="claim-pw2" className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t('web:portal.claim.confirm')}
        </label>
        <input
          id="claim-pw2"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-primary-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
      >
        {busy ? t('web:portal.claim.submitting') : t('web:portal.claim.submit')}
      </button>
    </form>
  )
}
