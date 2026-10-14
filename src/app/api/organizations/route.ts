import { getSessionUserId } from '@/lib/auth-session'
import { listOrganizationsForUser } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { CreateOrganizationError, createOrganizationWithOwner } from '@/lib/organizations-server'
import { NextResponse } from 'next/server'

/**
 * GET  /api/organizations  → the caller's workspaces (membership + organization)
 * POST /api/organizations  → self-serve workspace creation (PRD 5.1, #9)
 *
 * Both require the signed session cookie. The owner of the new organization is
 * the session user; the body only carries `name` and an optional `slug`.
 */
export async function GET() {
  const { t } = await getTranslations()
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 })

  const rows = await listOrganizationsForUser(userId)
  return NextResponse.json({
    organizations: rows.map(({ organization, membership }) => ({
      id: organization.$id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      role: membership.role,
    })),
  })
}

export async function POST(req: Request) {
  const { t } = await getTranslations()
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name : ''
  const slug = typeof body?.slug === 'string' ? body.slug : undefined

  try {
    const { organization, membership } = await createOrganizationWithOwner(userId, { name, slug })
    return NextResponse.json(
      {
        organization: {
          id: organization.$id,
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
          role: membership.role,
        },
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    if (err instanceof CreateOrganizationError) {
      const status = err.problem === 'slugTaken' ? 409 : 400
      return NextResponse.json({ error: t(`errors:organization.${err.problem}`), code: err.problem }, { status })
    }
    console.error('[organizations] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
