import ResetPasswordForm from '@/components/auth/ResetPasswordForm'
import { getTranslations } from '@/lib/i18n-server'
import Logo from '@/shared/Logo'
import { Metadata } from 'next'
import { Suspense } from 'react'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations()
  return {
    title: t('web:seo.resetPassword.title'),
    description: t('web:seo.resetPassword.description'),
    // The URL carries a one-time secret; keep it out of indexes and referrers.
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  }
}

// Landing page for Appwrite's recovery email (?userId=&secret=&expire=).
const Page = async () => {
  const { t } = await getTranslations()

  return (
    <div className="container pb-16">
      <div className="my-16 flex justify-center">
        <Logo className="w-32" />
      </div>

      <div className="mx-auto max-w-md space-y-6">
        <h2 className="text-center text-xl font-semibold text-neutral-900 dark:text-white">
          {t('web:resetPassword.title')}
        </h2>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  )
}

export default Page
