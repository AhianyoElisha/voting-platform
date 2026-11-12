import ProfileForm from '@/components/account/ProfileForm'
import { createAdminClient, withRetry } from '@/lib/appwrite-server'
import { getSessionUserId } from '@/lib/auth-session'
import { listOrganizationsForUser } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { listOwnNominees } from '@/lib/portal-server'
import { Badge } from '@/shared/Badge'
import { Heading } from '@/shared/Heading'
import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations()
  return { title: t('web:seo.account.title') }
}

/**
 * The signed-in user's own account: name (editable), sign-in email and phone
 * as Appwrite Auth holds them, the workspaces they belong to and, for a
 * nominee, the way into the portal. Everything is read for the session's
 * user id; nothing here takes an id from the URL.
 */
export default async function Page() {
  const { t } = await getTranslations()
  const userId = await getSessionUserId()
  if (!userId) redirect('/login?redirect=/account')

  const { users } = createAdminClient()
  const [authUser, workspaces, nominees] = await Promise.all([
    withRetry(() => users.get(userId)),
    listOrganizationsForUser(userId),
    listOwnNominees(userId),
  ])

  const card = 'surface p-5'
  const h2 = 'text-lg font-semibold text-neutral-900 dark:text-white'

  return (
    <main className="container py-16 lg:py-24">
      <Heading>{t('web:account.title')}</Heading>

      <div className="mt-10 grid max-w-3xl gap-6">
        <section className={card}>
          <h2 className={h2}>{t('web:account.profile')}</h2>
          <div className="mt-4">
            <ProfileForm fullName={authUser.name} />
          </div>
          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-neutral-800 dark:text-neutral-200">{t('web:account.email')}</dt>
              <dd className="break-all text-neutral-600 dark:text-neutral-300">{authUser.email}</dd>
            </div>
            <div>
              <dt className="font-medium text-neutral-800 dark:text-neutral-200">{t('web:account.phone')}</dt>
              <dd className="text-neutral-600 dark:text-neutral-300">{authUser.phone || t('web:account.noPhone')}</dd>
            </div>
          </dl>
        </section>

        <section className={card}>
          <h2 className={h2}>{t('web:account.password')}</h2>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{t('web:account.passwordHelper')}</p>
          <Link href="/forgot-password" className="mt-3 inline-block text-sm font-medium underline">
            {t('web:account.passwordCta')}
          </Link>
        </section>

        <section className={card}>
          <h2 className={h2}>{t('web:dashboard.workspaces.title')}</h2>
          {workspaces.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              {t('web:account.noWorkspaces')}{' '}
              <Link href="/dashboard" className="font-medium underline">
                {t('web:dashboard.create.cta')}
              </Link>
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-700">
              {workspaces.map(({ organization, membership }) => (
                <li key={organization.$id} className="flex items-center justify-between gap-3 py-3">
                  <Link href={`/dashboard/${organization.slug}/events`} className="font-medium underline">
                    {organization.name}
                  </Link>
                  <Badge color="zinc">{t(`web:dashboard.role.${membership.role}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        {nominees.length > 0 && (
          <section className={card}>
            <h2 className={h2}>{t('web:nav.nomineePortal.label')}</h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{t('web:nav.nomineePortal.helper')}</p>
            <Link href="/portal" className="mt-3 inline-block text-sm font-medium underline">
              {t('web:account.portalCta')}
            </Link>
          </section>
        )}
      </div>
    </main>
  )
}
