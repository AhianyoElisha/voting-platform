import { getSessionUserId } from '@/lib/auth-session'
import { ensureFlyer } from '@/lib/flyer/generate-server'
import { getTranslations } from '@/lib/i18n-server'
import { NotOwnNomineeError, ProfileError, updateOwnProfile } from '@/lib/portal-server'
import { NextResponse, after } from 'next/server'

type Params = { params: Promise<{ nomineeId: string }> }

/** PATCH { name?, bio?, photoFocus? } on the caller's own nominee row. */
export async function PATCH(req: Request, { params }: Params) {
  const { t } = await getTranslations()
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 })
  const { nomineeId } = await params
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  try {
    const nominee = await updateOwnProfile(userId, nomineeId, {
      name: typeof body?.name === 'string' ? body.name : undefined,
      bio: typeof body?.bio === 'string' ? body.bio : undefined,
      photoFocus: body && 'photoFocus' in body ? body.photoFocus : undefined,
    })
    after(() => ensureFlyer(nominee.$id).catch((err) => console.error('[flyer] after profile update', err)))
    return NextResponse.json({ nominee: { id: nominee.$id, name: nominee.name, bio: nominee.bio } })
  } catch (err) {
    if (err instanceof NotOwnNomineeError)
      return NextResponse.json({ error: t('errors:tenant.notFound'), code: 'notFound' }, { status: 404 })
    if (err instanceof ProfileError)
      return NextResponse.json({ error: t(`errors:profile.${err.problem}`), code: err.problem }, { status: 400 })
    console.error('[portal.profile] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
