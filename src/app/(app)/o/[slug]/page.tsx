import PublicEventCard from '@/components/events/PublicEventCard'
import BrandBand from '@/components/organization/BrandBand'
import { parseBrandColors } from '@/lib/branding'
import { APPWRITE } from '@/lib/constants'
import { getOrganizationBySlug, listTenantDocuments, type TenantContext } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { PUBLIC_EVENT_STATUSES, groupPublicEvents } from '@/lib/public-events'
import type { EventDoc } from '@/lib/types'
import { Heading } from '@/shared/Heading'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Query } from 'node-appwrite'

type Props = { params: Promise<{ slug: string }> }

async function load(slug: string) {
  const organization = await getOrganizationBySlug(slug)
  if (!organization || organization.status !== 'active') return null
  return organization
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const organization = await load(slug)
  if (!organization) return {}
  const { t } = await getTranslations()
  return {
    title: organization.name,
    description: t('web:orgHome.description', { name: organization.name }),
  }
}

/**
 * An organization's public home (PRD 5.1 "branded public page"): its logo and
 * colours, and every event the public may see, grouped as voting now, coming
 * up and paused. Drafts and closed events stay hidden, as on the event page.
 * Suspended organizations are not found.
 */
export default async function OrganizationHomePage({ params }: Props) {
  const { slug } = await params
  const organization = await load(slug)
  if (!organization) notFound()
  const { t } = await getTranslations()
  const ctx: TenantContext = { organizationId: organization.$id, userId: 'public', role: 'scanner' }
  const events = await listTenantDocuments<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, [
    Query.equal('status', [...PUBLIC_EVENT_STATUSES]),
    Query.limit(100),
  ])
  const groups = groupPublicEvents(events.documents)
  const sections = [
    { key: 'live', items: groups.live },
    { key: 'upcoming', items: groups.upcoming },
    { key: 'paused', items: groups.paused },
  ].filter((s) => s.items.length > 0)

  return (
    <main className="container py-16 lg:py-24">
      <BrandBand
        name={organization.name}
        logoUrl={organization.logoUrl}
        colors={parseBrandColors(organization.brandColors)}
        className="mb-6"
      />
      <Heading>{organization.name}</Heading>

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
                {section.items.map((event) => (
                  <li key={event.$id}>
                    <PublicEventCard event={event} organizationSlug={organization.slug} t={t} />
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
