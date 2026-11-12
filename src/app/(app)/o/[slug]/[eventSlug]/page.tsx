import TicketBuyForm from '@/components/tickets/TicketBuyForm'
import { APPWRITE } from '@/lib/constants'
import { getOrganizationBySlug, listTenantDocuments, type TenantContext } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import { isMockProviderActive } from '@/lib/payments'
import { shapeResults } from '@/lib/results'
import { availableNow } from '@/lib/tickets/purchase-server'
import { listPublicTiers } from '@/lib/tickets/tiers-server'
import type { CategoryDoc, EventDoc, NomineeDoc, RoundDoc, RoundEntryDoc } from '@/lib/types'
import { freeVotesByNominee } from '@/lib/votes-server'
import { Heading } from '@/shared/Heading'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Query } from 'node-appwrite'

type Props = { params: Promise<{ slug: string; eventSlug: string }> }

/** Statuses the public may see. Drafts and closed events stay private for now. */
const PUBLIC_STATUSES = new Set(['scheduled', 'live', 'paused'])

/**
 * Public event page (PRD 5.3, "browse events, categories and nominees") with
 * results shaped by the organizer's visibility choice (PRD 5.4). The tenant
 * is resolved from the slug; there is no caller membership, so the context is
 * a read-only public one scoped to that organization.
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
  const [categories, nominees, rounds] = await Promise.all([
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
    listTenantDocuments<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, [
      Query.equal('eventId', [event.$id]),
      Query.orderDesc('number'),
      Query.limit(100),
    ]),
  ])

  // Results for the live round, else the most recent one.
  const round = rounds.documents.find((r) => r.status === 'live') ?? rounds.documents[0] ?? null
  let results: ReturnType<typeof shapeResults> = null
  if (round && event.resultsVisibility !== 'hidden') {
    const entries = await listTenantDocuments<RoundEntryDoc>(ctx, APPWRITE.TABLES.ROUND_ENTRIES, [
      Query.equal('roundId', [round.$id]),
      Query.limit(500),
    ])
    const byNominee = new Map(entries.documents.map((e) => [e.nomineeId, e.voteCount]))
    const freeByNominee = await freeVotesByNominee(ctx, round.$id)
    results = shapeResults(
      nominees.documents.map((n) => ({
        nomineeId: n.$id,
        free: freeByNominee.get(n.$id) ?? 0,
        name: n.name,
        categoryId: n.categoryId,
        votes: byNominee.get(n.$id) ?? 0,
      })),
      event.resultsVisibility
    )
  }
  const resultFor = (nomineeId: string) => results?.find((r) => r.nomineeId === nomineeId)
  const live = event.status === 'live'
  const tiers = await listPublicTiers(organization.$id, event.$id)
  const tierOptions = await Promise.all(
    tiers.map(async (tier) => ({
      id: tier.$id,
      name: tier.name,
      price: tier.price,
      remaining: await availableNow(ctx, tier, new Date()),
    }))
  )

  return (
    <main className="container py-16 lg:py-24">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{organization.name}</p>
      <Heading>{event.title}</Heading>
      {event.description && (
        <p className="mt-3 max-w-2xl text-neutral-600 dark:text-neutral-300">{event.description}</p>
      )}
      <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
        {t('web:publicEvent.pricePerVote', { price: formatPesewas(event.votePrice) })}
        {round && rounds.documents.length > 1 ? ` · ${round.name}` : ''}
      </p>

      <div className="mt-10 space-y-8">
        {categories.documents.map((category) => (
          <section key={category.$id}>
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{category.name}</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {nominees.documents
                .filter((n) => n.categoryId === category.$id)
                .sort(
                  (a, b) =>
                    (resultFor(a.$id)?.rank ?? 0) - (resultFor(b.$id)?.rank ?? 0) || a.name.localeCompare(b.name)
                )
                .map((n) => {
                  const r = resultFor(n.$id)
                  return (
                    <li
                      key={n.$id}
                      className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium text-neutral-900 dark:text-white">
                          {n.name}
                        </p>
                        {r && (
                          <span className="shrink-0 text-sm font-semibold text-primary-700 dark:text-primary-300">
                            {r.votes !== undefined
                              ? t('web:publicEvent.votes', { count: r.votes })
                              : r.percent !== undefined
                                ? `${r.percent}%`
                                : `#${r.rank}`}
                            {r.free !== undefined && (
                              <span
                                className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-300"
                                title={t('web:publicEvent.freeHelper')}
                              >
                                · {t('web:publicEvent.free', { count: r.free })}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        {t('web:publicEvent.code')}{' '}
                        <span className="font-mono text-neutral-900 dark:text-white">{n.code}</span>
                      </p>
                      <Link
                        href={`/o/${slug}/${eventSlug}/vote/${n.code}`}
                        className={`mt-3 inline-block rounded-xl px-4 py-2 text-sm font-medium ${live ? 'bg-primary-600 text-white hover:bg-primary-700' : 'bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400'}`}
                      >
                        {live ? t('web:publicEvent.vote') : t('web:publicEvent.view')}
                      </Link>
                    </li>
                  )
                })}
            </ul>
          </section>
        ))}
      </div>
      {tierOptions.length > 0 && (
        <section className="mt-12 max-w-xl space-y-4">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:tickets.section.title')}</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:tickets.section.helper')}</p>
          <TicketBuyForm
            tiers={tierOptions}
            mockProvider={process.env.NODE_ENV !== 'production' && isMockProviderActive()}
          />
        </section>
      )}

      {results?.some((r) => r.free !== undefined) && (
        <p className="mt-8 text-xs text-neutral-500 dark:text-neutral-400">{t('web:publicEvent.freeHelper')}</p>
      )}

      {!live && <p className="mt-10 text-sm text-neutral-500 dark:text-neutral-400">{t('web:publicEvent.notLive')}</p>}
    </main>
  )
}
