import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { maskPhone } from '@/lib/phone'
import { scanTicket } from '@/lib/tickets/scan-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string }> }

/**
 * POST { token }: the entrance scan. Scanner, staff, admin and owner roles.
 * The buyer's phone comes back masked: the door only needs to tell buyers
 * apart, so the full number never reaches the scanning phone (#28).
 */
export async function POST(req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    const result = await scanTicket(r.ctx, eventId, str(body.token))
    const ticket = 'ticket' in result ? result.ticket : null
    return NextResponse.json({
      outcome: result.outcome,
      ticket: ticket
        ? {
            id: ticket.$id,
            buyerName: ticket.buyerName,
            buyerPhone: maskPhone(ticket.buyerPhone),
            tierId: ticket.tierId,
            status: ticket.status,
            usedAt: ticket.usedAt,
            scannedBy: ticket.scannedBy,
          }
        : null,
    })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'tickets.scan')
  }
}
