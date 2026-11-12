import { buyerTickets } from '@/lib/tickets/purchase-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ paymentId: string }> }

/**
 * GET: the tickets of a confirmed ticket purchase, for the buyer's page. The
 * payment id is printed inside every ticket, so it is not enough on its own:
 * the request must carry the buyer's access key (`X-Payment-Key`), returned
 * only by the initiate call. A header, not a query string, so it stays out of
 * request logs. Any mismatch is a plain 404.
 */
export async function GET(req: Request, { params }: Params) {
  const { paymentId } = await params
  const out = await buyerTickets(paymentId, req.headers.get('x-payment-key'))
  if (!out) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(
    {
      status: out.status,
      tierName: out.tierName,
      tickets: out.tickets.map((t) => ({ id: t.id, token: t.token, status: t.status, url: `/t/${t.token}` })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
