import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { closeRound, getRound, openRound, setRoundPrice } from '@/lib/rounds-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string; roundId: string }> }

/**
 * PATCH `{ status: 'live' | 'closed' }` (closed is terminal, rule 3b), or
 * `{ votePriceCedis }` to set a pending round's own price; empty clears it.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { orgId, eventId, roundId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  const status = str(body.status)
  try {
    const round = await getRound(r.ctx, roundId)
    if (round.eventId !== eventId) {
      return NextResponse.json({ error: r.t('errors:tenant.notFound'), code: 'notFound' }, { status: 404 })
    }
    if ('votePriceCedis' in body) {
      const typed = typeof body.votePriceCedis === 'string' ? body.votePriceCedis : null
      return NextResponse.json({ round: await setRoundPrice(r.ctx, eventId, roundId, typed) })
    }
    if (status === 'live') return NextResponse.json({ round: await openRound(r.ctx, roundId) })
    if (status === 'closed') return NextResponse.json({ round: await closeRound(r.ctx, roundId) })
    return NextResponse.json({ error: r.t('errors:round.badTransition'), code: 'badTransition' }, { status: 400 })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'rounds.status')
  }
}
