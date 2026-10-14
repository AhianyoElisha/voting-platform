import { domainErrorResponse, readJson, withTenant } from '@/lib/api-tenant'
import { generateForEvent } from '@/lib/flyer/generate-server'
import { assertCanDesign } from '@/lib/tenant'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string }> }

/** POST { offset?, force? }: renders up to ten flyers and says where to continue. */
export async function POST(req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    assertCanDesign(r.ctx)
    const offset = Number.isInteger(body.offset) ? (body.offset as number) : 0
    const result = await generateForEvent(r.ctx, eventId, { offset, limit: 10, force: body.force === true })
    return NextResponse.json(result)
  } catch (err) {
    return domainErrorResponse(err, r.t, 'flyers.generate')
  }
}
