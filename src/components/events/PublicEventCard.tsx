import { formatPesewas } from '@/lib/money'
import type { EventDoc } from '@/lib/types'
import { Badge } from '@/shared/Badge'
import type { TFunction } from 'i18next'
import Link from 'next/link'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Africa/Accra',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const BADGE = { live: 'green', scheduled: 'sky', paused: 'amber' } as const

/** A public event as a card: on an organization's page and in the platform directory. */
export default function PublicEventCard({
  event,
  organizationSlug,
  organizationName,
  t,
}: {
  event: Pick<EventDoc, 'title' | 'slug' | 'description' | 'status' | 'startsAt' | 'endsAt' | 'votePrice'>
  organizationSlug: string
  /** Shown in the directory, where cards from several organizations sit together. */
  organizationName?: string
  t: TFunction
}) {
  return (
    <Link
      href={`/o/${organizationSlug}/${event.slug}`}
      className="block h-full rounded-2xl border border-neutral-200 p-4 transition hover:border-primary-300 dark:border-neutral-700"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-neutral-900 dark:text-white">{event.title}</p>
        <Badge color={BADGE[event.status as keyof typeof BADGE] ?? 'zinc'}>
          {t(`web:events.status.${event.status}`)}
        </Badge>
      </div>
      {organizationName && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{organizationName}</p>}
      {event.description && (
        <p className="mt-2 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">{event.description}</p>
      )}
      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        {event.status === 'scheduled'
          ? t('web:orgHome.opens', { when: when(event.startsAt) })
          : t('web:orgHome.closes', { when: when(event.endsAt) })}
        {' · '}
        {t('web:publicEvent.pricePerVote', { price: formatPesewas(event.votePrice) })}
      </p>
    </Link>
  )
}
