import { APPWRITE } from '@/lib/constants'
import { getOrganizationBySlug, listTenantDocuments, type TenantContext } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import type { CategoryDoc, EventDoc, NomineeDoc } from '@/lib/types'
import { Heading } from '@/shared/Heading'
import { notFound } from 'next/navigation'
import { Query } from 'node-appwrite'

type Props = { params: Promise<{ slug: string; eventSlug: string }> }

/** Statuses the public may see. Drafts and closed events stay private for now. */
const PUBLIC_STATUSES = new Set(['scheduled', 'live', 'paused'])

/**
 * Public event page (PRD 5.3, "browse events, categories and nominees").
 * Read-only and tally-free: results visibility (#26) only matters once votes
 * exist. The tenant is resolved from the slug; there is no caller membership,
 * so the context is a read-only public one scoped to that organization.
 */
export default async function PublicEventPage({ params }: Props) {
  const { slug, eventSlug } = await params
  const organization = await getOrganizationBySlug(slug)
  if (!organization || organization.status !== 'active') notFound()

  const ctx: TenantContext = { organizationId: organization.$id, userId: 'public', role: 'scanner' }
  const events = await listTenantDocuments<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, [
    Query.equal('slug', [eventSlug]),
    Query.limit(1),
  ])
  const event = events.documents[0]
  if (!event || !PUBLIC_STATUSES.has(event.status)) notFound()

  const { t } = await getTranslations()
  const [categories, nominees] = await Promise.all([
    listTenantDocuments<CategoryDoc>(ctx, APPWRITE.TABLES.CATEGORIES, [
      Query.equal('eventId', [event.$id]),
      Query.orderAsc('order'),
      Query.limit(100),
    ]),
    listTenantDocuments<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, [
      Query.equal('eventId', [event.$id]),
      Query.equal('status', ['active']),
      Query.limit(500),
    ]),
  ])

  return (
    <main className="container py-16 lg:py-24">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{organization.name}</p>
      <Heading>{event.title}</Heading>
      {event.description && (
        <p className="mt-3 max-w-2xl text-neutral-600 dark:text-neutral-300">{event.description}</p>
      )}
      <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
        {t('web:publicEvent.pricePerVote', { price: formatPesewas(event.votePrice) })}
      </p>

      <div className="mt-10 space-y-8">
        {categories.documents.map((category) => (
          <section key={category.$id}>
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{category.name}</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {nominees.documents
                .filter((n) => n.categoryId === category.$id)
                .map((n) => (
                  <li
                    key={n.$id}
                    className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800"
                  >
                    <p className="font-medium text-neutral-900 dark:text-white">{n.name}</p>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                      {t('web:publicEvent.code')}{' '}
                      <span className="font-mono text-neutral-900 dark:text-white">{n.code}</span>
                    </p>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-10 text-sm text-neutral-500 dark:text-neutral-400">{t('web:publicEvent.votingSoon')}</p>
    </main>
  )
}
