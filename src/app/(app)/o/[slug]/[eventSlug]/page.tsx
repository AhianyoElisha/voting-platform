import BrandBand from '@/components/organization/BrandBand'
import PhotoAvatar from '@/components/PhotoAvatar'
import TicketBuyForm from '@/components/tickets/TicketBuyForm'
import { parseBrandColors, textColorOn } from '@/lib/branding'
import { APPWRITE } from '@/lib/constants'
import { getOrganizationBySlug, listTenantDocuments, type TenantContext } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import { isMockProviderActive } from '@/lib/payments'
import { focusOf } from '@/lib/photo-focus'
import { isPublicEvent } from '@/lib/public-events'
import { shapeResults } from '@/lib/results'
import { availableNow } from '@/lib/tickets/purchase-server'
import { listPublicTiers } from '@/lib/tickets/tiers-server'
import type { CategoryDoc, EventDoc, NomineeDoc, RoundDoc, RoundEntryDoc } from '@/lib/types'
import { freeVotesByNominee } from '@/lib/votes-server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Query } from 'node-appwrite'

type Props = { params: Promise<{ slug: string; eventSlug: string }> }

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
  if (!event || !isPublicEvent(event)) notFound()

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

  const brand = parseBrandColors(organization.brandColors)
  return (
    <main className="container py-16 lg:py-24">
      <BrandBand
        href={`/o/${organization.slug}`}
        name={organization.name}
        logoUrl={organization.logoUrl}
        colors={parseBrandColors(organization.brandColors)}
        className="mb-6"
      />
      <header
        className={`relative overflow-hidden rounded-3xl px-6 py-10 shadow-xl sm:px-10 sm:py-12 ${brand ? '' : 'bg-linear-to-br from-primary-700 via-primary-600 to-secondary-600 text-white shadow-primary-600/20'}`}
        style={
          brand
            ? {
                // The organization's own colour, deepened toward one corner.
                background: `linear-gradient(135deg, ${brand.primary}, color-mix(in srgb, ${brand.primary} 72%, black))`,
                color: textColorOn(brand.primary),
              }
            : undefined
        }
      >
        <span aria-hidden className="absolute -top-16 -right-10 size-56 rounded-full bg-white/10" />
        <span aria-hidden className="absolute -bottom-24 left-1/3 size-64 rounded-full bg-white/10" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
            {live && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-green-300" />}
            {t(`web:events.status.${event.status}`)}
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-balance sm:text-5xl">{event.title}</h1>
          {event.description && <p className="mt-3 max-w-2xl opacity-90">{event.description}</p>}
          <div className="mt-6 flex flex-wrap gap-2 text-sm font-medium">
            <span className="rounded-full bg-white px-4 py-1.5 text-primary-700 shadow-sm">
              {t('web:publicEvent.pricePerVote', { price: formatPesewas(event.votePrice) })}
            </span>
            <span className="rounded-full bg-white/15 px-4 py-1.5 backdrop-blur-sm">
              {t('web:publicEvent.nominees', { count: nominees.documents.length })}
            </span>
            {round && rounds.documents.length > 1 && (
              <span className="rounded-full bg-white/15 px-4 py-1.5 backdrop-blur-sm">{round.name}</span>
            )}
          </div>
        </div>
      </header>

      <div className="mt-12 space-y-12">
        {categories.documents.map((category) => (
          <section key={category.$id}>
            <h2 className="section-title">{category.name}</h2>
            <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {nominees.documents
                .filter((n) => n.categoryId === category.$id)
                .sort(
                  (a, b) =>
                    (resultFor(a.$id)?.rank ?? 0) - (resultFor(b.$id)?.rank ?? 0) || a.name.localeCompare(b.name)
                )
                .map((n) => {
                  const r = resultFor(n.$id)
                  return (
                    <li key={n.$id}>
                      <Link
                        href={`/o/${slug}/${eventSlug}/vote/${n.code}`}
                        className="group flex h-full surface-hover flex-col overflow-hidden surface"
                      >
                        <div className="relative">
                          <PhotoAvatar
                            name={n.name}
                            photoUrl={n.photoUrl}
                            focus={focusOf(n)}
                            className="aspect-square w-full text-4xl transition duration-300 group-hover:scale-105"
                          />
                          {r && (
                            <span className="absolute top-2 left-2 rounded-full bg-neutral-900/80 px-2.5 py-1 text-xs font-bold text-white backdrop-blur-sm">
                              {r.votes !== undefined
                                ? t('web:publicEvent.votes', { count: r.votes })
                                : r.percent !== undefined
                                  ? `${r.percent}%`
                                  : `#${r.rank}`}
                            </span>
                          )}
                          <span className="absolute right-2 bottom-2 rounded-full bg-white/95 px-2.5 py-1 font-mono text-xs font-bold text-primary-700 shadow-sm">
                            {n.code}
                          </span>
                        </div>
                        <div className="flex flex-1 flex-col justify-end p-3 sm:p-4">
                          <p className="leading-snug font-semibold text-neutral-900 dark:text-white">{n.name}</p>
                          {r?.free !== undefined && (
                            <p
                              className="mt-0.5 text-xs text-amber-700 dark:text-amber-300"
                              title={t('web:publicEvent.freeHelper')}
                            >
                              {t('web:publicEvent.free', { count: r.free })}
                            </p>
                          )}
                          <span
                            className={`mt-3 block rounded-xl px-4 py-2 text-center text-sm font-semibold ${live ? 'btn-brand' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'}`}
                          >
                            {live ? t('web:publicEvent.vote') : t('web:publicEvent.view')}
                          </span>
                        </div>
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
          <h2 className="section-title">{t('web:tickets.section.title')}</h2>
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
