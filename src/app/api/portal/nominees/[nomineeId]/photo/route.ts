import { getSessionUserId } from '@/lib/auth-session'
import { getTranslations } from '@/lib/i18n-server'
import { validatePhotoUpload } from '@/lib/photo'
import { NotOwnNomineeError, attachPhoto } from '@/lib/portal-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ nomineeId: string }> }

/** POST multipart `photo`: the nominee's own photo, normalized server-side and stored in Appwrite Storage. */
export async function POST(req: Request, { params }: Params) {
  const { t } = await getTranslations()
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 })
  const { nomineeId } = await params

  const form = await req.formData().catch(() => null)
  const file = form?.get('photo')
  const upload = file instanceof File ? file : null
  const problem = validatePhotoUpload(upload)
  if (problem || !upload) {
    return NextResponse.json(
      { error: t(`errors:photo.${problem ?? 'missing'}`), code: problem ?? 'missing' },
      { status: 400 }
    )
  }

  try {
    const nominee = await attachPhoto(userId, nomineeId, new Uint8Array(await upload.arrayBuffer()))
    return NextResponse.json({
      nominee: { id: nominee.$id, photoUrl: nominee.photoUrl, profileCompletedAt: nominee.profileCompletedAt },
    })
  } catch (err) {
    if (err instanceof NotOwnNomineeError)
      return NextResponse.json({ error: t('errors:tenant.notFound'), code: 'notFound' }, { status: 404 })
    console.error('[portal.photo] Error:', err)
    return NextResponse.json({ error: t('errors:photo.failed') }, { status: 500 })
  }
}
