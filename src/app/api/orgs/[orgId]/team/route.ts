import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { teamErrorResponse } from '@/lib/team-api'
import { inviteMember, listInvites, listMembers } from '@/lib/team-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string }> }

/** GET: members and invites. POST { email, role }: invite (managers). */
export async function GET(_req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const [members, invites] = await Promise.all([listMembers(r.ctx), listInvites(r.ctx)])
  return NextResponse.json({
    members: members.map(({ membership, user }) => ({
      id: membership.$id,
      userId: membership.userId,
      role: membership.role,
      name: user?.fullName ?? null,
      email: user?.email ?? null,
    })),
    invites: invites.map((i) => ({
      id: i.$id,
      email: i.email,
      role: i.role,
      status: i.status,
      expiresAt: i.expiresAt,
    })),
  })
}

export async function POST(req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    const out = await inviteMember(
      r.ctx,
      { email: str(body.email), role: body.role },
      { baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin }
    )
    return NextResponse.json(
      {
        invite: { id: out.invite.$id, email: out.invite.email, role: out.invite.role },
        emailSent: out.emailSent,
        acceptUrl: out.acceptUrl,
      },
      { status: 201 }
    )
  } catch (err) {
    return teamErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'team.invite')
  }
}
