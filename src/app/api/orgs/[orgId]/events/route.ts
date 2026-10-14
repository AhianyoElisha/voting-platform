import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { createEvent, listEvents } from '@/lib/events-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string }> }

/** GET: the organization's events. POST: create one (managers only). */
export async function GET(_req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    return NextResponse.json({ events: await listEvents(r.ctx) })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'events.list')
  }
}

export async function POST(req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    const result = await createEvent(r.ctx, {
      title: str(body.title),
      slug: str(body.slug) || undefined,
      description: str(body.description),
      votePriceCedis: str(body.votePriceCedis),
      votePrice: typeof body.votePrice === 'number' ? body.votePrice : undefined,
      startsAt: str(body.startsAt),
      endsAt: str(body.endsAt),
      resultsVisibility: str(body.resultsVisibility),
      moraleCandidatesEnabled: body.moraleCandidatesEnabled === true,
      freeVotesEnabled: body.freeVotesEnabled === true,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'events.create')
  }
}
