import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { FreeVoteError, grantFreeVotes } from '@/lib/free-votes-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string; nomineeId: string }> }

/** POST { quantity, reason, idempotencyKey }: grant free votes (PRD 5.4a). Managers only; audited in the same transaction. */
export async function POST(req: Request, { params }: Params) {
  const { orgId, eventId, nomineeId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    const { outcome, vote } = await grantFreeVotes(r.ctx, {
      nomineeId,
      quantity: body.quantity,
      reason: str(body.reason),
      idempotencyKey: str(body.idempotencyKey),
      expectedEventId: eventId,
    })
    return NextResponse.json(
      { outcome, vote: { id: vote.$id, quantity: vote.quantity, roundId: vote.roundId } },
      { status: outcome === 'granted' ? 201 : 200 }
    )
  } catch (err) {
    if (err instanceof FreeVoteError) {
      const status = err.problem === 'wrongEvent' ? 404 : 400
      return NextResponse.json({ error: r.t(`errors:freeVotes.${err.problem}`), code: err.problem }, { status })
    }
    return domainErrorResponse(err, r.t, 'freeVotes.grant')
  }
}
