import { createAdminClient, withRetry } from '@/lib/appwrite-server'
import { APPWRITE } from '@/lib/constants'
import { databaseId, getOrganization } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { verifyTicketToken } from '@/lib/tickets/token'
import type { EventDoc, TicketDoc, TicketTierDoc } from '@/lib/types'
import { Heading } from '@/shared/Heading'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'

type Props = { params: Promise<{ token: string }> }

/** The page is meant to be forwarded; the door sees the full number, the link does not. */
function maskPhone(phone: string): string {
  return phone.length > 3 ? `${'•'.repeat(Math.max(0, phone.length - 3))}${phone.slice(-3)}` : phone
}

/**
 * The buyer's ticket. Reachable only with the signed token, which is also what
 * the QR encodes, so the door scanner reads exactly this URL.
 */
export default async function TicketPage({ params }: Props) {
  const { token } = await params
  const id = verifyTicketToken(token)
  if (!id) notFound()
  const { databases } = createAdminClient()
  let ticket: TicketDoc
  try {
    ticket = await withRetry(() => databases.getDocument<TicketDoc>(databaseId(), APPWRITE.TABLES.TICKETS, id))
  } catch {
    notFound()
  }
  if (ticket.qrToken !== token) notFound()
  const [event, tier, organization] = await Promise.all([
    withRetry(() => databases.getDocument<EventDoc>(databaseId(), APPWRITE.TABLES.EVENTS, ticket.eventId)),
    withRetry(() => databases.getDocument<TicketTierDoc>(databaseId(), APPWRITE.TABLES.TICKET_TIERS, ticket.tierId)),
    getOrganization(ticket.organizationId),
  ])
  const { t } = await getTranslations()
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const svg = await QRCode.toString(`${base}/t/${token}`, { type: 'svg', margin: 1, width: 280 })

  return (
    <main className="container py-10">
      <div className="mx-auto max-w-sm space-y-4 rounded-3xl border border-neutral-200 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-800">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{organization?.name ?? ''}</p>
        <Heading level={2}>{event.title}</Heading>
        <p className="font-medium text-neutral-900 dark:text-white">{tier.name}</p>
        {ticket.status === 'valid' ? (
          <div
            className="mx-auto w-full max-w-[280px] rounded-2xl bg-white p-2"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="rounded-2xl bg-neutral-100 p-6 text-sm text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
            {ticket.status === 'used'
              ? t('web:ticket.used', {
                  time: ticket.usedAt
                    ? new Date(ticket.usedAt).toLocaleString('en-GB', { timeZone: 'Africa/Accra' })
                    : '',
                })
              : t('web:ticket.cancelled')}
          </div>
        )}
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {ticket.buyerName ?? ''} {ticket.buyerName ? '·' : ''} {maskPhone(ticket.buyerPhone)}
        </p>
        <p className="font-mono text-xs break-all text-neutral-400">{ticket.$id}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('web:ticket.showAtDoor')}</p>
      </div>
    </main>
  )
}
