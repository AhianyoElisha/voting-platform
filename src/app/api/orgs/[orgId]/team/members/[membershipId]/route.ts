import { domainErrorResponse, readJson, withTenant } from '@/lib/api-tenant'
import { teamErrorResponse } from '@/lib/team-api'
import { changeRole, removeMember } from '@/lib/team-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; membershipId: string }> }

/** PATCH { role }: change a non-owner's role. DELETE: remove a member. */
export async function PATCH(req: Request, { params }: Params) {
  const { orgId, membershipId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    const m = await changeRole(r.ctx, membershipId, body.role)
    return NextResponse.json({ membership: { id: m.$id, role: m.role } })
  } catch (err) {
    return teamErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'team.role')
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { orgId, membershipId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    await removeMember(r.ctx, membershipId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return teamErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'team.remove')
  }
}
