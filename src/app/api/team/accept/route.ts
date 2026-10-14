import { getSessionUserId } from '@/lib/auth-session'
import { getOrganization } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { rateLimit } from '@/lib/rate-limit'
import { teamErrorResponse } from '@/lib/team-api'
import { acceptInvite } from '@/lib/team-server'
import { NextResponse } from 'next/server'

/** POST { token }: the signed-in user joins the workspace the invite names. */
export async function POST(req: Request) {
  const { t } = await getTranslations()
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 })
  if (!rateLimit(`team-accept:${userId}`, 10, 60_000).ok) {
    return NextResponse.json({ error: t('errors:vote.rateLimited'), code: 'rateLimited' }, { status: 429 })
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  try {
    const { membership } = await acceptInvite(userId, typeof body?.token === 'string' ? body.token : '')
    const organization = await getOrganization(membership.organizationId)
    return NextResponse.json({
      organization: {
        id: membership.organizationId,
        slug: organization?.slug ?? null,
        name: organization?.name ?? null,
      },
      role: membership.role,
    })
  } catch (err) {
    const mapped = teamErrorResponse(err, t)
    if (mapped) return mapped
    console.error('[team.accept] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
