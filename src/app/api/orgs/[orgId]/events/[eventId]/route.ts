import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { getEvent, setEventStatus } from '@/lib/events-server'
import { listCategories, listNominees } from '@/lib/nominees-server'
import { listRounds } from '@/lib/rounds-server'
import { EVENT_STATUSES, type EventStatus } from '@/lib/types'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string }> }

/** GET: the event with its categories, nominees and rounds. PATCH: `{ status }` transition. */
export async function GET(_req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    const event = await getEvent(r.ctx, eventId)
    const [categories, nominees, rounds] = await Promise.all([
      listCategories(r.ctx, eventId),
      listNominees(r.ctx, eventId),
      listRounds(r.ctx, eventId),
    ])
    return NextResponse.json({ event, categories, nominees, rounds })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'events.get')
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  const status = str(body.status) as EventStatus
  if (!EVENT_STATUSES.includes(status)) {
    return NextResponse.json({ error: r.t('errors:event.badTransition'), code: 'badTransition' }, { status: 400 })
  }
  try {
    return NextResponse.json({ event: await setEventStatus(r.ctx, eventId, status) })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'events.status')
  }
}
