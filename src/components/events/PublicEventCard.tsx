import { formatPesewas } from '@/lib/money'
import type { EventDoc } from '@/lib/types'
import { Badge } from '@/shared/Badge'
import { ArrowRightIcon, CalendarDaysIcon } from '@heroicons/react/24/outline'
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
      className="group flex h-full surface-hover flex-col overflow-hidden surface"
    >
      <div className="relative h-20 bg-linear-to-br from-primary-600 via-primary-500 to-secondary-500">
        <span
          aria-hidden
          className="absolute -top-6 -right-6 size-28 rounded-full bg-white/15 transition duration-300 group-hover:scale-110"
        />
        <span aria-hidden className="absolute -bottom-10 left-8 size-24 rounded-full bg-white/10" />
        <span className="absolute top-3 right-3">
          <Badge color={BADGE[event.status as keyof typeof BADGE] ?? 'zinc'} className="bg-white/90! shadow-sm">
            {event.status === 'live' && (
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-green-500" />
            )}
            {t(`web:events.status.${event.status}`)}
          </Badge>
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white">{event.title}</p>
        {organizationName && <p className="text-sm text-neutral-500 dark:text-neutral-400">{organizationName}</p>}
        {event.description && (
          <p className="mt-2 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">{event.description}</p>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <CalendarDaysIcon className="size-4 shrink-0" aria-hidden />
          {event.status === 'scheduled'
            ? t('web:orgHome.opens', { when: when(event.startsAt) })
            : t('web:orgHome.closes', { when: when(event.endsAt) })}
        </p>
        <div className="mt-auto flex items-center justify-between pt-4">
          <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
            {t('web:publicEvent.pricePerVote', { price: formatPesewas(event.votePrice) })}
          </span>
          <ArrowRightIcon
            aria-hidden
            className="size-4 text-neutral-400 transition group-hover:translate-x-1 group-hover:text-primary-600"
          />
        </div>
      </div>
    </Link>
  )
}
