import { getSessionUserId } from '@/lib/auth-session'
import { getTranslations } from '@/lib/i18n-server'
import { portalEntries } from '@/lib/portal-server'
import { NextResponse } from 'next/server'

/** GET: the signed-in nominee's entries. Vote counts are deliberately absent (#33). */
export async function GET() {
  const { t } = await getTranslations()
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 })
  const entries = await portalEntries(userId)
  return NextResponse.json({
    entries: entries.map(({ nominee, event, category, organizationSlug }) => ({
      id: nominee.$id,
      name: nominee.name,
      code: nominee.code,
      bio: nominee.bio,
      photoUrl: nominee.photoUrl,
      profileCompletedAt: nominee.profileCompletedAt,
      event,
      category,
      organizationSlug,
    })),
  })
}
