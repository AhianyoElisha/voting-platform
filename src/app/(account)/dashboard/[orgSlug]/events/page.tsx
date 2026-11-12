import { listEvents } from '@/lib/events-server'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import { resolveWorkspace } from '@/lib/page-tenant'
import { canManage } from '@/lib/tenant'
import { Badge } from '@/shared/Badge'
import { Heading } from '@/shared/Heading'
import Link from 'next/link'

type Props = { params: Promise<{ orgSlug: string }> }

const STATUS_COLOR = { draft: 'zinc', scheduled: 'blue', live: 'green', paused: 'amber', closed: 'red' } as const

export default async function EventsPage({ params }: Props) {
  const { orgSlug } = await params
  const { ctx, organization } = await resolveWorkspace(orgSlug, `/dashboard/${orgSlug}/events`)
  const { t } = await getTranslations()
  const events = await listEvents(ctx)

  return (
    <main className="container py-16 lg:py-24">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        <Link href="/dashboard" className="underline">
          {t('web:dashboard.title')}
        </Link>{' '}
        / {organization.name}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
        <Heading>{t('web:events.list.title')}</Heading>
        {canManage(ctx.role) && (
          <Link
            href={`/dashboard/${orgSlug}/events/new`}
            className="rounded-xl btn-brand px-4 py-2 text-sm font-medium"
          >
            {t('web:events.list.create')}
          </Link>
        )}
      </div>

      {events.length === 0 ? (
        <p className="mt-10 text-neutral-500 dark:text-neutral-400">{t('web:events.list.empty')}</p>
      ) : (
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <li key={event.$id} className="surface p-5">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/dashboard/${orgSlug}/events/${event.$id}`}
                  className="font-semibold text-neutral-900 hover:underline dark:text-white"
                >
                  {event.title}
                </Link>
                <Badge color={STATUS_COLOR[event.status]}>{t(`web:events.status.${event.status}`)}</Badge>
              </div>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                {t('web:events.list.pricePerVote', { price: formatPesewas(event.votePrice) })}
              </p>
              <p className="mt-1 font-mono text-xs break-all text-neutral-500 dark:text-neutral-400">
                /o/{orgSlug}/{event.slug}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
