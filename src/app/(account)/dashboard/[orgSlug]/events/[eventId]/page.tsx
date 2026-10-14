import { AddCategoryForm, AddNomineeForm, EventStatusControls, RoundControls } from '@/components/events/EventControls'
import InviteButton from '@/components/events/InviteButton'
import FlyerPanel from '@/components/flyer/FlyerPanel'
import { TenantMismatchError } from '@/lib/db'
import { getEvent } from '@/lib/events-server'
import { flyerUrl, flyersForEvent } from '@/lib/flyer/generate-server'
import { listTemplates } from '@/lib/flyer/templates-server'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import { listCategories, listNominees } from '@/lib/nominees-server'
import { resolveWorkspace } from '@/lib/page-tenant'
import { listRounds } from '@/lib/rounds-server'
import { canDesign, canManage } from '@/lib/tenant'
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
  const [templates, flyers] = await Promise.all([listTemplates(ctx, eventId), flyersForEvent(ctx, eventId)])
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
                  {rows.map(({ nominee, entry }, i) => (
                    <tr key={entry.$id}>
                      <td className="w-10 px-4 py-2 text-neutral-500">{i + 1}</td>
                      <td className="px-4 py-2 text-neutral-900 dark:text-white">
                        {nominee.name}
                        {nominee.isMorale && (
                          <span className="ml-2 text-xs text-amber-600">{t('web:events.nominees.moraleBadge')}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-neutral-500">{nominee.code}</td>
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
