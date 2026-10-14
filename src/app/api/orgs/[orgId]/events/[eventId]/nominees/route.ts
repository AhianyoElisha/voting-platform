import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { createNominee } from '@/lib/nominees-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    const result = await createNominee(r.ctx, {
      eventId,
      categoryId: str(body.categoryId),
      name: str(body.name),
      bio: str(body.bio),
      email: str(body.email) || undefined,
      isMorale: body.isMorale === true,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'nominees.create')
  }
}
