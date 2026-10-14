import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { APPWRITE } from '@/lib/constants'
import { getTenantDocument } from '@/lib/db'
import { ticketErrorResponse, tierView } from '@/lib/tickets/api'
import { updateTier } from '@/lib/tickets/tiers-server'
import type { TicketTierDoc } from '@/lib/types'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string; tierId: string }> }

/** PATCH any of name, priceCedis, quantityAvailable, salesStart, salesEnd, status. */
export async function PATCH(req: Request, { params }: Params) {
  const { orgId, eventId, tierId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    const existing = await getTenantDocument<TicketTierDoc>(r.ctx, APPWRITE.TABLES.TICKET_TIERS, tierId)
    if (existing.eventId !== eventId) {
      return NextResponse.json({ error: r.t('errors:tenant.notFound'), code: 'notFound' }, { status: 404 })
    }
    const tier = await updateTier(r.ctx, tierId, {
      name: body.name === undefined ? undefined : str(body.name),
      priceCedis: body.priceCedis === undefined ? undefined : str(body.priceCedis),
      quantityAvailable:
        body.quantityAvailable === undefined
          ? undefined
          : body.quantityAvailable === null || body.quantityAvailable === ''
            ? null
            : Number(body.quantityAvailable),
      salesStart: body.salesStart === undefined ? undefined : str(body.salesStart) || null,
      salesEnd: body.salesEnd === undefined ? undefined : str(body.salesEnd) || null,
      status: body.status === 'hidden' || body.status === 'active' ? body.status : undefined,
    })
    return NextResponse.json({ tier: tierView(tier) })
  } catch (err) {
    return ticketErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'tiers.update')
  }
}
