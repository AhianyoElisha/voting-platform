import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { payoutErrorResponse, payoutView } from '@/lib/payouts-api'
import { cancelPayout } from '@/lib/payouts-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; payoutId: string }> }

/** DELETE: the organizer withdraws a request nobody has acted on. */
export async function DELETE(_req: Request, { params }: Params) {
  const { orgId, payoutId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    return NextResponse.json({ payout: payoutView(await cancelPayout(r.ctx, payoutId)) })
  } catch (err) {
    return payoutErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'payouts.cancel')
  }
}
