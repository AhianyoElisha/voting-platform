import ClaimForm from '@/components/portal/ClaimForm'
import { getTranslations } from '@/lib/i18n-server'
import { checkInviteToken } from '@/lib/invite-token'
import { findNomineeByInviteToken } from '@/lib/nominee-invite-server'
import Logo from '@/shared/Logo'
import { Metadata } from 'next'
import Link from 'next/link'

type Props = { params: Promise<{ token: string }> }

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations()
  return { title: t('web:seo.claim.title') }
}

/** Claim page: validates the link before showing the form, so a dead link gets a message rather than a form that fails. */
export default async function ClaimPage({ params }: Props) {
  const { token } = await params
  const { t } = await getTranslations()
  const nominee = await findNomineeByInviteToken(token)
  const check = nominee ? checkInviteToken(token, nominee) : 'invalid'

  return (
    <div className="container pb-16">
      <div className="my-16 flex justify-center">
        <Logo className="w-36" />
      </div>
      <div className="mx-auto max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:portal.claim.title')}</h1>
          {check === 'ok' && nominee && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {nominee.name} · {nominee.email}
            </p>
          )}
        </div>
        {check === 'ok' ? (
          <>
            <p className="text-center text-sm text-neutral-600 dark:text-neutral-300">{t('web:portal.claim.body')}</p>
            <ClaimForm token={token} />
          </>
        ) : (
          <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center dark:border-amber-800 dark:bg-amber-900/20">
            <p className="text-sm text-amber-800 dark:text-amber-300">{t(`errors:claim.${check}`)}</p>
            {check === 'used' && (
              <Link href="/login?redirect=/portal" className="inline-block text-sm font-medium underline">
                {t('web:portal.signIn.cta')}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
