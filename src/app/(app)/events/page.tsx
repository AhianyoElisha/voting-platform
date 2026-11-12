import PublicEventCard from '@/components/events/PublicEventCard'
import { getTranslations } from '@/lib/i18n-server'
import { groupPublicEvents } from '@/lib/public-events'
import { listDirectoryEvents } from '@/lib/public-events-server'
import { Heading } from '@/shared/Heading'
import { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations()
  return { title: t('web:directory.title'), description: t('web:directory.description') }
}

/**
 * The platform's event directory (PRD 5.3, "browse events"): every public
 * event of every active organization, grouped as on an organization's own
 * page. Rendered on request, like the other public pages.
 */
export default async function EventsPage() {
  const { t } = await getTranslations()
  const entries = await listDirectoryEvents()
  const groups = groupPublicEvents(
    entries.map(({ event, organization }) => ({
      id: event.$id,
      title: event.title,
      slug: event.slug,
      description: event.description,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      votePrice: event.votePrice,
      organizationSlug: organization.slug,
      organizationName: organization.name,
    }))
  )
  const sections = [
    { key: 'live', items: groups.live },
    { key: 'upcoming', items: groups.upcoming },
    { key: 'paused', items: groups.paused },
  ].filter((s) => s.items.length > 0)

  return (
    <main className="container py-16 lg:py-24">
      <Heading>{t('web:directory.title')}</Heading>
      <p className="mt-4 text-neutral-500 dark:text-neutral-400">{t('web:directory.subtitle')}</p>

      {sections.length === 0 ? (
        <p className="mt-8 text-neutral-600 dark:text-neutral-300">{t('web:orgHome.none')}</p>
      ) : (
        <div className="mt-10 space-y-10">
          {sections.map((section) => (
            <section key={section.key}>
              <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">
                {t(`web:orgHome.section.${section.key}`)}
              </h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <PublicEventCard
                      event={item}
                      organizationSlug={item.organizationSlug}
                      organizationName={item.organizationName}
                      t={t}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
