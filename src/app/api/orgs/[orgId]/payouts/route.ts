import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { balanceFor } from '@/lib/ledger-server'
import { payoutErrorResponse, payoutView } from '@/lib/payouts-api'
import { listPayouts, requestPayout } from '@/lib/payouts-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string }> }

/** GET: balance and payout history. POST { amountCedis, destination, idempotencyKey }: request one (managers). */
export async function GET(_req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const [balance, payouts] = await Promise.all([balanceFor(r.ctx), listPayouts(r.ctx)])
  return NextResponse.json({ balance, payouts: payouts.map((p) => payoutView(p)) })
}

export async function POST(req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    const { outcome, payout } = await requestPayout(r.ctx, {
      amountCedis: str(body.amountCedis),
      destination: body.destination,
      idempotencyKey: str(body.idempotencyKey),
    })
    return NextResponse.json({ outcome, payout: payoutView(payout) }, { status: outcome === 'requested' ? 201 : 200 })
  } catch (err) {
    return payoutErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'payouts.request')
  }
}
