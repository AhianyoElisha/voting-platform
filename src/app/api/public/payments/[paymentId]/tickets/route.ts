import { createAdminClient, withRetry } from '@/lib/appwrite-server'
import { APPWRITE } from '@/lib/constants'
import { databaseId } from '@/lib/db'
import type { TicketDoc, TicketTierDoc } from '@/lib/types'
import { getPayment } from '@/lib/votes-server'
import { NextResponse } from 'next/server'
import { Query } from 'node-appwrite'

type Params = { params: Promise<{ paymentId: string }> }

/** GET: the tickets of a successful payment, by the unguessable payment id the buyer's page holds. */
export async function GET(_req: Request, { params }: Params) {
  const { paymentId } = await params
  const payment = await getPayment(paymentId)
  if (!payment || payment.purpose !== 'ticket') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (payment.status !== 'success')
    return NextResponse.json({ status: payment.status, tickets: [] }, { headers: { 'Cache-Control': 'no-store' } })
  const { databases } = createAdminClient()
  const [tickets, tier] = await Promise.all([
    withRetry(() =>
      databases.listDocuments<TicketDoc>(databaseId(), APPWRITE.TABLES.TICKETS, [
        Query.equal('paymentId', [paymentId]),
        Query.limit(100),
      ])
    ),
    payment.tierId
      ? withRetry(() =>
          databases.getDocument<TicketTierDoc>(databaseId(), APPWRITE.TABLES.TICKET_TIERS, payment.tierId as string)
        )
      : null,
  ])
  return NextResponse.json(
    {
      status: payment.status,
      tierName: tier?.name ?? '',
      tickets: tickets.documents.map((t) => ({
        id: t.$id,
        token: t.qrToken,
        status: t.status,
        url: `/t/${t.qrToken}`,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
