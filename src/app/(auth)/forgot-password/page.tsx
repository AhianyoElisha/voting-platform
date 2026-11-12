import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm'
import { getTranslations } from '@/lib/i18n-server'
import Logo from '@/shared/Logo'
import { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations()
  return {
    title: t('web:seo.forgotPassword.title'),
    description: t('web:seo.forgotPassword.description'),
  }
}

// Same layout as pickLT's page, with the form wired to Appwrite's password
// recovery (src/lib/password-recovery.ts). The link lands on /reset-password.
const Page = async () => {
  const { t } = await getTranslations()

  return (
    <div className="container pb-16">
      <div className="my-16 flex justify-center">
        <Logo className="w-32" />
      </div>

      <div className="mx-auto max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:forgotPassword.title')}</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('web:forgotPassword.helper')}</p>
        </div>
        <ForgotPasswordForm />
      </div>
    </div>
  )
}

export default Page
