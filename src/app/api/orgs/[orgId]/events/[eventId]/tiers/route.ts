import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { ticketErrorResponse, tierView } from '@/lib/tickets/api'
import { createTier, listTiers } from '@/lib/tickets/tiers-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    return NextResponse.json({ tiers: (await listTiers(r.ctx, eventId)).map(tierView) })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'tiers.list')
  }
}

export async function POST(req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    const tier = await createTier(r.ctx, eventId, {
      name: str(body.name),
      priceCedis: str(body.priceCedis),
      quantityAvailable:
        body.quantityAvailable === null || body.quantityAvailable === '' || body.quantityAvailable === undefined
          ? null
          : Number(body.quantityAvailable),
      salesStart: str(body.salesStart) || null,
      salesEnd: str(body.salesEnd) || null,
    })
    return NextResponse.json({ tier: tierView(tier) }, { status: 201 })
  } catch (err) {
    return ticketErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'tiers.create')
  }
}
