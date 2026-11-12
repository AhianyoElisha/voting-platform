import { AccountError, updateOwnName } from '@/lib/account-server'
import { getSessionUserId } from '@/lib/auth-session'
import { getTranslations } from '@/lib/i18n-server'
import { NextRequest, NextResponse } from 'next/server'

/** PATCH /api/account/profile: the signed-in user changes their own name. */
export async function PATCH(req: NextRequest) {
  const { t } = await getTranslations()
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 })
  try {
    const body = await req.json().catch(() => null)
    const fullName = await updateOwnName(userId, body?.fullName)
    return NextResponse.json({ fullName })
  } catch (err) {
    if (err instanceof AccountError) {
      return NextResponse.json({ code: err.problem, error: t(`errors:account.${err.problem}`) }, { status: 400 })
    }
    console.error('[account.profile] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
