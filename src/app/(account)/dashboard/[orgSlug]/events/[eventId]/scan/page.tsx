import Scanner from '@/components/tickets/Scanner'
import { getEvent } from '@/lib/events-server'
import { getTranslations } from '@/lib/i18n-server'
import { resolveWorkspace } from '@/lib/page-tenant'
import { canScan } from '@/lib/tickets/scan-server'
import { Heading } from '@/shared/Heading'
import Link from 'next/link'
import { notFound } from 'next/navigation'

type Props = { params: Promise<{ orgSlug: string; eventId: string }> }

export default async function ScanPage({ params }: Props) {
  const { orgSlug, eventId } = await params
  const { ctx, organization } = await resolveWorkspace(orgSlug, `/dashboard/${orgSlug}/events/${eventId}/scan`)
  if (!canScan(ctx.role)) notFound()
  const { t } = await getTranslations()
  let event
  try {
    event = await getEvent(ctx, eventId)
  } catch {
    notFound()
  }
  return (
    <main className="container space-y-6 py-10">
      <div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          <Link href={`/dashboard/${orgSlug}/events/${eventId}`} className="underline">
            {organization.name}
          </Link>{' '}
          / {event.title}
        </p>
        <Heading>{t('web:scan.title')}</Heading>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t('web:scan.intro')}</p>
      </div>
      <Scanner orgId={organization.$id} eventId={eventId} />
    </main>
  )
}
