import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { createRound } from '@/lib/rounds-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    return NextResponse.json({ round: await createRound(r.ctx, eventId, str(body.name)) }, { status: 201 })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'rounds.create')
  }
}
