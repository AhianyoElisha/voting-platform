'use client'

import { useAuth } from '@/context/auth'
import Logo from '@/shared/Logo'
import { ArrowRight01Icon, ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Email/password sign-in. Same page layout as pickLT's login (logo, centred
 * card, inline error, show/hide password). Google sign-in and phone
 * verification are not built.
 */
function LoginContent() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const router = useRouter()
  const redirectPath = searchParams.get('redirect')

  const { loginWithEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await loginWithEmail(email, password)
      router.push(redirectPath && redirectPath.startsWith('/') ? redirectPath : '/dashboard')
    } catch (err: unknown) {
      const code = typeof err === 'object' && err && 'code' in err ? (err as { code?: number }).code : undefined
      if (code === 401) setError(t('errors:auth.invalidCredentials'))
      else if (code === 429) setError(t('errors:auth.rateLimited'))
      else setError(t('errors:auth.unknown'))
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
        {redirectPath && (
          <div className="rounded-xl border border-primary-100 bg-primary-50 p-4 text-center dark:border-primary-800 dark:bg-primary-900/20">
            <p className="text-sm text-primary-700 dark:text-primary-300">{t('web:login.resume.helper')}</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <h2 className="text-center text-xl font-semibold text-neutral-900 dark:text-white">{t('web:login.title')}</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
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
                className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 placeholder-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder-neutral-500"
                placeholder={t('auth:field.email.placeholder')}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                {t('auth:field.password.label')}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 pr-12 text-sm text-neutral-900 placeholder-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder-neutral-500"
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

            <div className="text-right">
              <Link
                href="/forgot-password"
                className="text-sm text-neutral-500 underline hover:text-neutral-700 dark:text-neutral-400"
              >
                {t('auth:login.forgotPassword.cta', { defaultValue: 'Forgot password?' })}
              </Link>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl btn-brand px-4 py-3 text-sm font-medium disabled:opacity-50"
            >
              {isSubmitting ? t('auth:login.submitting.cta') : t('auth:login.submit.cta')}
              {!isSubmitting && <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.5} />}
            </button>
          </form>
        </div>

        <div className="block text-center text-sm text-neutral-700 dark:text-neutral-300">
          {t('web:login.noAccount.label')} {` `}
          <Link href="/signup" className="font-medium underline">
            {t('auth:signup.createAccount.cta')}
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}
