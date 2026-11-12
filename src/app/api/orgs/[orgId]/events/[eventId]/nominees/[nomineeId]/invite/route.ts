import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { InviteError, inviteNominee } from '@/lib/nominee-invite-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string; nomineeId: string }> }

/**
 * POST: invite (or re-invite) the nominee to the portal. Managers only. The
 * nominee must belong to the event in the URL, checked before any work. When
 * the email was not sent (Resend unconfigured or failing, #32) the claim link comes back in the
 * response so the organizer can deliver it by hand.
 */
export async function POST(req: Request, { params }: Params) {
  const { orgId, eventId, nomineeId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    const origin = new URL(req.url).origin
    const out = await inviteNominee(r.ctx, nomineeId, {
      baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? origin,
      expectedEventId: eventId,
    })
    return NextResponse.json({
      mode: out.mode,
      emailSent: out.emailSent,
      emailProvider: out.emailProvider,
      claimUrl: out.claimUrl,
      nominee: { id: out.nominee.$id, inviteSentAt: out.nominee.inviteSentAt, claimedAt: out.nominee.claimedAt },
    })
  } catch (err) {
    if (err instanceof InviteError) {
      const status = err.problem === 'wrongEvent' ? 404 : 400
      return NextResponse.json({ error: r.t(`errors:invite.${err.problem}`), code: err.problem }, { status })
    }
    return domainErrorResponse(err, r.t, 'nominees.invite')
  }
}
