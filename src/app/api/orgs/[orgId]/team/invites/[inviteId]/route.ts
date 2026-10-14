import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { teamErrorResponse } from '@/lib/team-api'
import { resendInvite, revokeInvite } from '@/lib/team-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; inviteId: string }> }

/** POST: re-send with a fresh link. DELETE: revoke. */
export async function POST(req: Request, { params }: Params) {
  const { orgId, inviteId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    const out = await resendInvite(r.ctx, inviteId, {
      baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin,
    })
    return NextResponse.json({ emailSent: out.emailSent, acceptUrl: out.acceptUrl })
  } catch (err) {
    return teamErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'team.resend')
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { orgId, inviteId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    await revokeInvite(r.ctx, inviteId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return teamErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'team.revoke')
  }
}
