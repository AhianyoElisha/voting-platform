import BrandBand from '@/components/organization/BrandBand'
import { parseBrandColors } from '@/lib/branding'
import { APPWRITE } from '@/lib/constants'
import { getOrganizationBySlug, listTenantDocuments, type TenantContext } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import { PUBLIC_EVENT_STATUSES, groupPublicEvents } from '@/lib/public-events'
import type { EventDoc } from '@/lib/types'
import { Badge } from '@/shared/Badge'
import { Heading } from '@/shared/Heading'
import { Metadata } from 'next'
import Link from 'next/link'
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

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Africa/Accra',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

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
    { key: 'live', items: groups.live, badge: 'green' as const },
    { key: 'upcoming', items: groups.upcoming, badge: 'sky' as const },
    { key: 'paused', items: groups.paused, badge: 'amber' as const },
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
                    <Link
                      href={`/o/${organization.slug}/${event.slug}`}
                      className="block h-full rounded-2xl border border-neutral-200 p-4 transition hover:border-primary-300 dark:border-neutral-700"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-neutral-900 dark:text-white">{event.title}</p>
                        <Badge color={section.badge}>{t(`web:events.status.${event.status}`)}</Badge>
                      </div>
                      {event.description && (
                        <p className="mt-2 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">
                          {event.description}
                        </p>
                      )}
                      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
                        {event.status === 'scheduled'
                          ? t('web:orgHome.opens', { when: when(event.startsAt) })
                          : t('web:orgHome.closes', { when: when(event.endsAt) })}
                        {' · '}
                        {t('web:publicEvent.pricePerVote', { price: formatPesewas(event.votePrice) })}
                      </p>
                    </Link>
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
