import { domainErrorResponse, readJson, withTenant } from '@/lib/api-tenant'
import { setRoundEntrants } from '@/lib/rounds-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string; roundId: string }> }

/**
 * PUT `{ nomineeIds: string[] }`: the organizer's pick of who is in a pending
 * round (decision #30). Managers only; the round and every nominee must
 * belong to the event in the URL.
 */
export async function PUT(req: Request, { params }: Params) {
  const { orgId, eventId, roundId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  const ids = Array.isArray(body.nomineeIds) ? body.nomineeIds.filter((v): v is string => typeof v === 'string') : null
  if (!ids || ids.length > 500) {
    return NextResponse.json(
      { error: r.t('errors:round.nomineeNotInEvent'), code: 'nomineeNotInEvent' },
      { status: 400 }
    )
  }
  try {
    return NextResponse.json(await setRoundEntrants(r.ctx, eventId, roundId, ids))
  } catch (err) {
    return domainErrorResponse(err, r.t, 'rounds.entrants')
  }
}
