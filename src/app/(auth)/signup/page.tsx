'use client'

import OrganizationFields, { emptyOrganizationFields, inputClass } from '@/components/organization/OrganizationFields'
import { useAuth } from '@/context/auth'
import Logo from '@/shared/Logo'
import { ArrowRight01Icon, ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Organizer sign-up (PRD 5.1, decision #9): name, email, password and the
 * organization. The Appwrite Auth account is created in the browser, then the
 * workspace is created server-side through `POST /api/organizations` with the
 * session user as owner. If that second step fails the account still exists,
 * so the user is sent to the dashboard where the create form is offered again.
 */
function SignupContent() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')
  // An invitee arriving from a team invite only needs an account; the workspace already exists.
  const joining = !!redirect && redirect.startsWith('/team/accept/')
  const { signupWithEmail } = useAuth()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organization, setOrganization] = useState(emptyOrganizationFields)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError(t('errors:auth.passwordTooShort'))
      return
    }
    setIsSubmitting(true)
    try {
      await signupWithEmail(email, password, fullName.trim())
    } catch (err: unknown) {
      const code = typeof err === 'object' && err && 'code' in err ? (err as { code?: number }).code : undefined
      if (code === 409) setError(t('errors:auth.emailTaken'))
      else if (code === 429) setError(t('errors:auth.rateLimited'))
      else setError(t('errors:auth.unknown'))
      setIsSubmitting(false)
      return
    }

    if (joining) {
      router.push(redirect as string)
      return
    }

    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: organization.name, slug: organization.slug }),
      })
      if (!res.ok) {
        // The account exists; the dashboard offers the form again.
        const body = await res.json().catch(() => null)
        const code = typeof body?.code === 'string' ? body.code : 'createFailed'
        router.push(`/dashboard?notice=${encodeURIComponent(code)}`)
        return
      }
      router.push('/dashboard')
    } catch {
      router.push('/dashboard')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="container pb-16">
      <div className="my-16 flex justify-center">
        <Logo className="w-36" />
      </div>

      <div className="mx-auto max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:signup.title')}</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {joining ? t('web:signup.joinSubtitle') : t('web:signup.subtitle')}
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="fullName" className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {t('auth:field.fullName.label')}
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              autoComplete="name"
              className={inputClass}
              placeholder={t('auth:field.fullName.placeholder')}
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {t('auth:field.email.label')}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={inputClass}
              placeholder={t('auth:field.email.placeholder')}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {t('auth:field.password.label')}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={`${inputClass} pr-12`}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                <HugeiconsIcon icon={showPassword ? ViewOffIcon : ViewIcon} size={18} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {!joining && (
            <>
              <div className="border-t border-neutral-200 pt-4 dark:border-neutral-700" />
              <OrganizationFields value={organization} onChange={setOrganization} idPrefix="signup-org" />
            </>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {isSubmitting ? t('auth:signup.submitting.cta') : t('auth:signup.submit.cta')}
            {!isSubmitting && <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.5} />}
          </button>
        </form>

        <div className="block text-center text-sm text-neutral-700 dark:text-neutral-300">
          {t('web:signup.haveAccount.label')} {` `}
          <Link href="/login" className="font-medium underline">
            {t('auth:login.submit.cta')}
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupContent />
    </Suspense>
  )
}
