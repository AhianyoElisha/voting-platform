'use client'

import { inputClass } from '@/components/organization/OrganizationFields'
import { account } from '@/lib/appwrite'
import { MIN_PASSWORD_LENGTH, parseRecoveryParams, resetProblem } from '@/lib/password-recovery'
import { Alert02Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FormEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Sets the new password from the emailed link (`src/lib/password-recovery.ts`). */
export default function ResetPasswordForm() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const link = useMemo(() => parseRecoveryParams(searchParams), [searchParams])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [linkDead, setLinkDead] = useState(false)

  if (!link || link.expired || linkDead) {
    return (
      <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-800 dark:bg-amber-900/20">
        <HugeiconsIcon icon={Alert02Icon} size={40} className="mx-auto text-amber-600" />
        <p className="font-semibold text-neutral-900 dark:text-white">{t('web:resetPassword.invalid.title')}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('web:resetPassword.invalid.body')}</p>
        <Link
          href="/forgot-password"
          className="inline-block rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          {t('web:resetPassword.invalid.cta')}
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-900/20">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={40} className="mx-auto text-green-600" />
        <p className="font-semibold text-neutral-900 dark:text-white">{t('web:resetPassword.done.title')}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('web:resetPassword.done.body')}</p>
        <Link
          href="/login"
          className="inline-block rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          {t('web:resetPassword.done.cta')}
        </Link>
      </div>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('errors:auth.passwordTooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('web:resetPassword.mismatch'))
      return
    }
    setBusy(true)
    try {
      await account.updateRecovery(link.userId, link.secret, password)
      setDone(true)
    } catch (err) {
      const problem = resetProblem(err)
      if (problem === 'recoveryLinkInvalid') setLinkDead(true)
      else setError(t(`errors:auth.${problem}`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-center text-sm text-neutral-600 dark:text-neutral-400">{t('web:resetPassword.helper')}</p>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
      <div>
        <label htmlFor="reset-pw" className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t('web:resetPassword.password')}
        </label>
        <input
          id="reset-pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="reset-pw2" className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t('web:resetPassword.confirm')}
        </label>
        <input
          id="reset-pw2"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-primary-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
      >
        {busy ? t('web:resetPassword.submitting') : t('web:resetPassword.submit')}
      </button>
    </form>
  )
}
