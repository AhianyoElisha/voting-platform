import PhotoAvatar from '@/components/PhotoAvatar'
import CreateOrganizationForm from '@/components/organization/CreateOrganizationForm'
import { getSessionUserId } from '@/lib/auth-session'
import { listOrganizationsForUser } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { Badge } from '@/shared/Badge'
import { Heading } from '@/shared/Heading'
import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations()
  return { title: t('web:seo.dashboard.title') }
}

/** Signup forwards one of these when the account exists but the workspace could not be created. */
const NOTICE_CODES = new Set([
  'createFailed',
  'nameTooShort',
  'nameTooLong',
  'slugTaken',
  'slug.tooShort',
  'slug.tooLong',
  'slug.invalid',
  'slug.reserved',
])

/**
 * Organizer dashboard. Server-rendered: the session cookie identifies the
 * user and their memberships decide which workspaces they see (rule 4). A user
 * without a workspace gets the create form instead.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { t } = await getTranslations()
  const userId = await getSessionUserId()
  if (!userId) redirect('/login?redirect=/dashboard')

  const [workspaces, { notice: noticeCode }] = await Promise.all([listOrganizationsForUser(userId), searchParams])
  // Only a known code becomes a message: the URL never supplies free text.
  const notice = noticeCode && NOTICE_CODES.has(noticeCode) ? t(`errors:organization.${noticeCode}`) : null

  return (
    <main className="container py-16 lg:py-24">
      <Heading>{t('web:dashboard.title')}</Heading>

      {notice && (
        <div className="mx-auto mt-6 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-4 text-center dark:border-amber-800 dark:bg-amber-900/20">
          <p className="text-sm text-amber-800 dark:text-amber-300">{notice}</p>
        </div>
      )}

      {workspaces.length === 0 ? (
        <section className="mx-auto mt-10 max-w-md space-y-6">
          <div className="space-y-1 text-center">
            <h2 className="section-title">{t('web:dashboard.empty.title')}</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:dashboard.empty.body')}</p>
          </div>
          <CreateOrganizationForm />
        </section>
      ) : (
        <section className="mt-10 space-y-6">
          <div>
            <h2 className="section-title">{t('web:dashboard.workspaces.title')}</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:dashboard.workspaces.helper')}</p>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map(({ organization, membership }) => (
              <li key={organization.$id} className="flex flex-col surface p-5">
                <div className="flex items-start gap-3">
                  <PhotoAvatar
                    name={organization.name}
                    photoUrl={organization.logoUrl}
                    className="size-12 shrink-0 rounded-xl object-contain! text-base"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="leading-snug font-semibold text-neutral-900 dark:text-white">{organization.name}</h3>
                    <p className="font-mono text-xs break-all text-neutral-500 dark:text-neutral-400">
                      /o/{organization.slug}
                    </p>
                  </div>
                  <Badge color={organization.status === 'active' ? 'green' : 'red'}>
                    {t(`web:dashboard.status.${organization.status}`)}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
                  {t(`web:dashboard.role.${membership.role}`)}
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <Link
                    href={`/dashboard/${organization.slug}/events`}
                    className="rounded-full btn-brand px-4 py-2 text-sm font-semibold"
                  >
                    {t('web:dashboard.manageEvents')}
                  </Link>
                  {[
                    ['payouts', true],
                    ['team', true],
                    ['settings', membership.role === 'owner' || membership.role === 'admin'],
                  ]
                    .filter(([, show]) => show)
                    .map(([key]) => (
                      <Link
                        key={key as string}
                        href={`/dashboard/${organization.slug}/${key}`}
                        className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:border-primary-300 hover:text-primary-700 dark:border-neutral-600 dark:text-neutral-200"
                      >
                        {t(`web:dashboard.${key}`)}
                      </Link>
                    ))}
                </div>
              </li>
            ))}
          </ul>

          <details className="max-w-md">
            <summary className="cursor-pointer text-sm font-medium text-primary-600 dark:text-primary-400">
              {t('web:dashboard.create.another')}
            </summary>
            <div className="mt-4">
              <CreateOrganizationForm />
            </div>
          </details>
        </section>
      )}
    </main>
  )
}
