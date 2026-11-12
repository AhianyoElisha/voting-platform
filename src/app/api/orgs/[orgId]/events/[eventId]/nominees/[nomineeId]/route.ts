import { domainErrorResponse, readJson, withTenant } from '@/lib/api-tenant'
import { ensureFlyer } from '@/lib/flyer/generate-server'
import { updateNominee } from '@/lib/nominees-server'
import { NextResponse, after } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string; nomineeId: string }> }

const optional = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** PATCH { name?, bio?, email?, photoFocus? }: organizer edits. Managers only; the nominee must be in the event in the URL. */
export async function PATCH(req: Request, { params }: Params) {
  const { orgId, eventId, nomineeId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    const nominee = await updateNominee(r.ctx, eventId, nomineeId, {
      name: optional(body.name),
      bio: optional(body.bio),
      email: optional(body.email),
      photoFocus: 'photoFocus' in body ? body.photoFocus : undefined,
    })
    // The name is on the flyer; ensureFlyer does nothing when nothing it draws changed.
    after(() => ensureFlyer(nominee.$id).catch((err) => console.error('[flyer] after nominee edit', err)))
    return NextResponse.json({
      nominee: { id: nominee.$id, name: nominee.name, bio: nominee.bio, email: nominee.email },
    })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'nominees.update')
  }
}
