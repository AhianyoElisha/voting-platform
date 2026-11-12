import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { ensureFlyer } from '@/lib/flyer/generate-server'
import { setNomineePhoto } from '@/lib/nominees-server'
import { validatePhotoUpload } from '@/lib/photo'
import { NextResponse, after } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string; nomineeId: string }> }

/**
 * POST multipart `photo`: the organizer uploads a nominee's photo, for
 * nominees who will not use the portal. Same normalization as the portal
 * upload; the flyer follows after the response is sent.
 */
export async function POST(req: Request, { params }: Params) {
  const { orgId, eventId, nomineeId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response

  const form = await req.formData().catch(() => null)
  const file = form?.get('photo')
  const upload = file instanceof File ? file : null
  const problem = validatePhotoUpload(upload)
  if (problem || !upload) {
    return NextResponse.json(
      { error: r.t(`errors:photo.${problem ?? 'missing'}`), code: problem ?? 'missing' },
      { status: 400 }
    )
  }

  try {
    const nominee = await setNomineePhoto(r.ctx, eventId, nomineeId, new Uint8Array(await upload.arrayBuffer()))
    after(() => ensureFlyer(nominee.$id).catch((err) => console.error('[flyer] after organizer photo upload', err)))
    return NextResponse.json({ nominee: { id: nominee.$id, photoUrl: nominee.photoUrl } })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'nominees.photo')
  }
}
