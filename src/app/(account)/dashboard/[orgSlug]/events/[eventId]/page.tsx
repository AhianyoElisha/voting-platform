import { AddCategoryForm, AddNomineeForm, EventStatusControls, RoundControls } from '@/components/events/EventControls'
import FreeVotesControl from '@/components/events/FreeVotesControl'
import InviteButton from '@/components/events/InviteButton'
import NomineeEditControl from '@/components/events/NomineeEditControl'
import FlyerPanel from '@/components/flyer/FlyerPanel'
import TiersPanel from '@/components/tickets/TiersPanel'
import { freeVotesEnabledOnPlatform } from '@/lib/constants'
import { TenantMismatchError } from '@/lib/db'
import { getEvent } from '@/lib/events-server'
import { flyerUrl, flyersForEvent } from '@/lib/flyer/generate-server'
import { listTemplates } from '@/lib/flyer/templates-server'
import { canGrantFreeVotes, listFreeVoteGrants } from '@/lib/free-votes-server'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import { listCategories, listNominees } from '@/lib/nominees-server'
import { resolveWorkspace } from '@/lib/page-tenant'
import { maskPhone } from '@/lib/phone'
import { focusOf } from '@/lib/photo-focus'
import { loadCumulativeReport } from '@/lib/report/data'
import { listRounds } from '@/lib/rounds-server'
import { canDesign, canManage } from '@/lib/tenant'
import { canScan } from '@/lib/tickets/scan-server'
import { listTickets, listTiers, ticketFigures } from '@/lib/tickets/tiers-server'
import { eventFigures, tallyForRound } from '@/lib/votes-server'
import { Badge } from '@/shared/Badge'
import { Heading } from '@/shared/Heading'
import Link from 'next/link'
import { notFound } from 'next/navigation'

type Props = { params: Promise<{ orgSlug: string; eventId: string }> }

const STATUS_COLOR = { draft: 'zinc', scheduled: 'blue', live: 'green', paused: 'amber', closed: 'red' } as const

export default async function EventDetailPage({ params }: Props) {
  const { orgSlug, eventId } = await params
  const { ctx, organization } = await resolveWorkspace(orgSlug, `/dashboard/${orgSlug}/events/${eventId}`)
  const { t } = await getTranslations()

  let event
  try {
    event = await getEvent(ctx, eventId)
  } catch (err) {
    if (err instanceof TenantMismatchError || (err as { code?: number })?.code === 404) notFound()
    throw err
  }
  const [categories, nominees, rounds, figures] = await Promise.all([
    listCategories(ctx, eventId),
    listNominees(ctx, eventId),
    listRounds(ctx, eventId),
    eventFigures(ctx, eventId),
  ])
  const tallies = await Promise.all(rounds.map(async (round) => ({ round, rows: await tallyForRound(ctx, round.$id) })))
  const [templates, flyers, tiers, tickets, tFigures] = await Promise.all([
    listTemplates(ctx, eventId),
    flyersForEvent(ctx, eventId),
    listTiers(ctx, eventId),
    listTickets(ctx, eventId),
    ticketFigures(ctx, eventId),
  ])
  const tierName = new Map(tiers.map((tier) => [tier.$id, tier.name]))
  const { report } = await loadCumulativeReport(ctx, eventId)
  const grants = await listFreeVoteGrants(ctx, eventId)
  const nomineeName = new Map(nominees.map((n) => [n.$id, n.name]))
  const freeVotesOn = canGrantFreeVotes({
    platformEnabled: freeVotesEnabledOnPlatform(),
    organizationEnabled: organization.freeVotesEnabled === true,
    eventEnabled: event.freeVotesEnabled === true,
    role: ctx.role,
  })
  const flyerByNominee = new Map(flyers.map(({ flyer, nominee }) => [nominee.$id, flyer]))
  const categoryName = new Map(categories.map((c) => [c.$id, c.name]))
  const manager = canManage(ctx.role)
  const open = event.status !== 'closed'

  return (
    <main className="container space-y-12 py-16 lg:py-24">
      <div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          <Link href="/dashboard" className="underline">
            {t('web:dashboard.title')}
          </Link>{' '}
          /{' '}
          <Link href={`/dashboard/${orgSlug}/events`} className="underline">
            {organization.name}
          </Link>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Heading>{event.title}</Heading>
          <Badge color={STATUS_COLOR[event.status]}>{t(`web:events.status.${event.status}`)}</Badge>
          {event.moraleCandidatesEnabled && <Badge color="amber">{t('web:events.moraleEnabled')}</Badge>}
        </div>
        <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">{t('web:events.detail.price')}</dt>
            <dd className="font-medium text-neutral-900 dark:text-white">{formatPesewas(event.votePrice)}</dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">{t('web:events.detail.window')}</dt>
            <dd className="font-medium text-neutral-900 dark:text-white">
              {new Date(event.startsAt).toLocaleString('en-GB', { timeZone: 'Africa/Accra' })} –{' '}
              {new Date(event.endsAt).toLocaleString('en-GB', { timeZone: 'Africa/Accra' })}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">{t('web:events.detail.visibility')}</dt>
            <dd className="font-medium text-neutral-900 dark:text-white">
              {t(`web:events.visibility.${event.resultsVisibility}`)}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">{t('web:events.detail.publicPage')}</dt>
            <dd className="font-mono text-xs break-all">
              <Link href={`/o/${orgSlug}/${event.slug}`} className="underline">
                /o/{orgSlug}/{event.slug}
              </Link>
            </dd>
          </div>
        </dl>
        <div className="mt-4">
          <EventStatusControls orgId={organization.$id} event={event} canManage={manager} />
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:events.results.title')}</h2>
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ['paidVotes', String(figures.paidVotes)],
              ['freeVotes', String(figures.freeVotes)],
              ['totalVotes', String(figures.totalVotes)],
              ['gross', formatPesewas(figures.gross)],
              ['platformShare', formatPesewas(figures.platformShare)],
              ['organizerShare', formatPesewas(figures.organizerShare)],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-700">
              <dt className="text-xs text-neutral-500 uppercase dark:text-neutral-400">
                {t(`web:events.results.${key}`)}
              </dt>
              <dd className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`/api/orgs/${organization.$id}/events/${event.$id}/report.pdf`}
            className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            {t('web:report.download')}
          </a>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {report.provisional ? t('web:report.provisional') : t('web:report.final')}
          </span>
        </div>
        {rounds.length > 1 && (
          <div className="space-y-4">
            <h3 className="font-medium text-neutral-900 dark:text-white">{t('web:report.cumulativeTitle')}</h3>
            {report.categories.map((category) => (
              <div
                key={category.categoryId}
                className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-700"
              >
                <div className="border-b border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-900 dark:border-neutral-700 dark:text-white">
                  {category.name}
                </div>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-neutral-500 uppercase dark:text-neutral-400">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">{t('web:events.nominees.name')}</th>
                      {report.rounds.map((r) => (
                        <th key={r.id} className="px-3 py-2 text-right">
                          {r.name}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right">{t('web:report.paid')}</th>
                      <th className="px-3 py-2 text-right">{t('web:report.free')}</th>
                      <th className="px-3 py-2 text-right">{t('web:report.total')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
                    {category.nominees.map((row) => (
                      <tr key={row.nomineeId}>
                        <td className="px-3 py-2 text-neutral-500">{row.rank}</td>
                        <td className="px-3 py-2 text-neutral-900 dark:text-white">
                          {row.name}
                          {row.isMorale && (
                            <span className="ml-2 text-xs text-amber-600">{t('web:events.nominees.moraleBadge')}</span>
                          )}
                        </td>
                        {row.perRound.map((v, i) => (
                          <td key={report.rounds[i].id} className="px-3 py-2 text-right">
                            {v === null ? '—' : v}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right">{row.paid}</td>
                        <td className="px-3 py-2 text-right">{row.free}</td>
                        <td className="px-3 py-2 text-right font-semibold text-neutral-900 dark:text-white">
                          {row.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
        {grants.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-amber-700 dark:text-amber-300">
              {t('web:freeVotes.recent', { count: grants.length })}
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-neutral-600 dark:text-neutral-300">
              {grants.map((g) => (
                <li key={g.$id}>
                  {new Date(g.$createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Accra' })} · {g.quantity} →{' '}
                  {nomineeName.get(g.nomineeId) ?? g.nomineeId} · {g.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {tallies.map(({ round, rows }) => (
          <div key={round.$id} className="rounded-2xl border border-neutral-200 dark:border-neutral-700">
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
              <h3 className="font-medium text-neutral-900 dark:text-white">{round.name}</h3>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {t(`web:events.rounds.status.${round.status}`)}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">
                {t('web:events.results.noEntries')}
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
                  {rows.map(({ nominee, entry, free }, i) => (
                    <tr key={entry.$id}>
                      <td className="w-10 px-4 py-2 text-neutral-500">{i + 1}</td>
                      <td className="px-4 py-2 text-neutral-900 dark:text-white">
                        {nominee.name}
                        {nominee.isMorale && (
                          <span className="ml-2 text-xs text-amber-600">{t('web:events.nominees.moraleBadge')}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-neutral-500">{nominee.code}</td>
                      <td className="px-4 py-2 text-right text-xs text-amber-700 dark:text-amber-300">
                        {free > 0 ? t('web:publicEvent.free', { count: free }) : ''}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-neutral-900 dark:text-white">
                        {entry.voteCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:events.rounds.title')}</h2>
        <RoundControls orgId={organization.$id} eventId={event.$id} rounds={rounds} canManage={manager && open} />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:tickets.panel.title')}</h2>
          {canScan(ctx.role) && (
            <Link
              href={`/dashboard/${orgSlug}/events/${eventId}/scan`}
              className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              {t('web:tickets.panel.scan')}
            </Link>
          )}
        </div>
        <dl className="grid gap-4 sm:grid-cols-4">
          {(
            [
              ['sold', String(tFigures.ticketsSold)],
              ['used', String(tFigures.ticketsUsed)],
              ['gross', formatPesewas(tFigures.gross)],
              ['organizerShare', formatPesewas(tFigures.organizerShare)],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-700">
              <dt className="text-xs text-neutral-500 uppercase dark:text-neutral-400">
                {t(`web:tickets.panel.figures.${key}`)}
              </dt>
              <dd className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">{value}</dd>
            </div>
          ))}
        </dl>
        <TiersPanel
          orgId={organization.$id}
          eventId={event.$id}
          tiers={tiers.map((tier) => ({
            id: tier.$id,
            name: tier.name,
            price: tier.price,
            quantityAvailable: tier.quantityAvailable,
            quantitySold: tier.quantitySold,
            status: tier.status,
          }))}
          canManage={manager && open}
        />
        {tickets.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-primary-600 dark:text-primary-400">
              {t('web:tickets.panel.list.title')} ({tickets.length})
            </summary>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-neutral-500 uppercase dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2">{t('web:tickets.panel.list.buyer')}</th>
                  <th className="px-3 py-2">{t('web:tickets.panel.list.tier')}</th>
                  <th className="px-3 py-2">{t('web:tickets.panel.list.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
                {tickets.slice(0, 200).map((tk) => (
                  <tr key={tk.$id}>
                    <td className="px-3 py-2 text-neutral-900 dark:text-white">
                      {tk.buyerName ?? ''}{' '}
                      {/* Full numbers for managers only; scanner and staff roles can read this page too (#28). */}
                      <span className="text-neutral-500">{manager ? tk.buyerPhone : maskPhone(tk.buyerPhone)}</span>
                    </td>
                    <td className="px-3 py-2">{tierName.get(tk.tierId) ?? ''}</td>
                    <td className="px-3 py-2">{t(`web:tickets.panel.status.${tk.status}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:flyer.panel.title')}</h2>
        <FlyerPanel
          orgId={organization.$id}
          orgSlug={orgSlug}
          eventId={event.$id}
          templates={templates.map((tpl) => ({
            id: tpl.$id,
            name: tpl.name,
            status: tpl.status,
            version: tpl.version,
            categoryName: tpl.categoryId ? (categoryName.get(tpl.categoryId) ?? null) : null,
            hasBackground: !!tpl.backgroundFileId,
          }))}
          categories={categories.map((c) => ({ id: c.$id, name: c.name }))}
          generatedCount={flyers.length}
          nomineeCount={nominees.length}
          canDesign={canDesign(ctx.role) && open}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:events.categories.title')}</h2>
        {categories.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:events.categories.empty')}</p>
        )}
        {categories.map((category) => {
          const members = nominees.filter((n) => n.categoryId === category.$id)
          return (
            <div key={category.$id} className="rounded-2xl border border-neutral-200 dark:border-neutral-700">
              <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
                <h3 className="font-medium text-neutral-900 dark:text-white">{category.name}</h3>
              </div>
              {members.length === 0 ? (
                <p className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">
                  {t('web:events.nominees.empty')}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-neutral-500 uppercase dark:text-neutral-400">
                    <tr>
                      <th className="px-4 py-2">{t('web:events.nominees.name')}</th>
                      <th className="px-4 py-2">{t('web:events.nominees.code')}</th>
                      <th className="px-4 py-2">{t('web:events.nominees.portal')}</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
                    {members.map((n) => (
                      <tr key={n.$id}>
                        <td className="px-4 py-2 text-neutral-900 dark:text-white">{n.name}</td>
                        <td className="px-4 py-2 font-mono">{n.code}</td>
                        <td className="px-4 py-2">
                          {manager && open ? (
                            <InviteButton
                              orgId={organization.$id}
                              eventId={event.$id}
                              nomineeId={n.$id}
                              hasEmail={!!n.email}
                              state={n.claimedAt ? 'claimed' : n.inviteTokenHash ? 'sent' : 'none'}
                            />
                          ) : (
                            <span className="text-xs text-neutral-500">
                              {t(
                                `web:events.nominees.inviteState.${n.claimedAt ? 'claimed' : n.inviteTokenHash ? 'sent' : 'none'}`
                              )}
                            </span>
                          )}
                          <span className="mt-1 block text-xs text-neutral-400">
                            {n.photoUrl ? t('web:events.nominees.photo.yes') : t('web:events.nominees.photo.no')}
                          </span>
                          {flyerByNominee.get(n.$id) && (
                            <a
                              href={flyerUrl(flyerByNominee.get(n.$id)!.fileId)}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block text-xs text-primary-600 underline"
                            >
                              {t('web:events.nominees.flyer')}
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {n.isMorale && <Badge color="amber">{t('web:events.nominees.moraleBadge')}</Badge>}
                          {manager && open && (
                            <div className="mt-1">
                              <NomineeEditControl
                                orgId={organization.$id}
                                eventId={event.$id}
                                nominee={{
                                  id: n.$id,
                                  name: n.name,
                                  email: n.email,
                                  bio: n.bio,
                                  claimed: !!n.claimedAt,
                                  photoUrl: n.photoUrl,
                                  photoFocus: focusOf(n),
                                }}
                              />
                            </div>
                          )}
                          {freeVotesOn && open && (
                            <div className="mt-1">
                              <FreeVotesControl
                                orgId={organization.$id}
                                eventId={event.$id}
                                nomineeId={n.$id}
                                nomineeName={n.name}
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
        {manager && open && <AddCategoryForm orgId={organization.$id} eventId={event.$id} />}
      </section>

      {manager && open && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">
            {t('web:events.nominees.addTitle')}
          </h2>
          <AddNomineeForm orgId={organization.$id} event={event} categories={categories} />
        </section>
      )}
    </main>
  )
}
