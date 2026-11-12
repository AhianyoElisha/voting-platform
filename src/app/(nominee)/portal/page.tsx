import NomineeCard from '@/components/portal/NomineeCard'
import { getSessionUserId } from '@/lib/auth-session'
import { getTranslations } from '@/lib/i18n-server'
import { focusOf } from '@/lib/photo-focus'
import { portalEntries } from '@/lib/portal-server'
import { Heading } from '@/shared/Heading'
import { Metadata } from 'next'
import { redirect } from 'next/navigation'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations()
  return { title: t('web:seo.portal.title') }
}

/**
 * Nominee portal (PRD 5.2a). Everything shown belongs to the signed-in user
 * through `Nominee.userId`; the middleware already requires a session here.
 */
export default async function PortalPage() {
  const { t } = await getTranslations()
  const userId = await getSessionUserId()
  if (!userId) redirect('/login?redirect=/portal')
  const entries = await portalEntries(userId)

  return (
    <main className="container space-y-8 py-16 lg:py-24">
      <div>
        <Heading>{t('web:portal.title')}</Heading>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{t('web:portal.intro')}</p>
      </div>
      {entries.length === 0 ? (
        <div className="mx-auto max-w-md space-y-1 rounded-2xl border border-neutral-200 p-6 text-center dark:border-neutral-700">
          <p className="font-semibold text-neutral-900 dark:text-white">{t('web:portal.empty.title')}</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:portal.empty.body')}</p>
        </div>
      ) : (
        entries.map(({ nominee, flyerUrl, event, category, organizationSlug }) => (
          <NomineeCard
            key={nominee.$id}
            entry={{
              id: nominee.$id,
              name: nominee.name,
              code: nominee.code,
              bio: nominee.bio,
              photoUrl: nominee.photoUrl,
              photoFocus: focusOf(nominee),
              profileCompletedAt: nominee.profileCompletedAt,
              flyerUrl,
              event: event ? { title: event.title, slug: event.slug, status: event.status } : null,
              category: category ? { name: category.name } : null,
              organizationSlug,
            }}
          />
        ))
      )}
    </main>
  )
}
