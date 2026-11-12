import { AdminError, parseSettingsPatch, updateOrganizationSettings } from '@/lib/admin-server'
import { getTranslations } from '@/lib/i18n-server'
import { requireSuperAdmin } from '@/lib/super-admin'
import { ForbiddenError } from '@/lib/tenant'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string }> }

/**
 * PATCH { status?, commissionRate?, moraleCandidatesEnabled?, freeVotesEnabled?, reason? }
 * Super admin only (PRD 5.7); audited in `updateOrganizationSettings`.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { t } = await getTranslations()
  let admin: string | null
  try {
    admin = await requireSuperAdmin()
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    throw err
  }
  if (!admin) return NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 })
  const { orgId } = await params
  try {
    const patch = parseSettingsPatch(await req.json().catch(() => null))
    const organization = await updateOrganizationSettings(admin, orgId, patch)
    return NextResponse.json({
      organization: {
        id: organization.$id,
        status: organization.status,
        commissionRate: organization.commissionRate ?? null,
        moraleCandidatesEnabled: organization.moraleCandidatesEnabled,
        freeVotesEnabled: organization.freeVotesEnabled,
      },
    })
  } catch (err) {
    if (err instanceof AdminError) {
      const status = err.problem === 'notFound' ? 404 : 400
      return NextResponse.json({ error: t(`errors:admin.${err.problem}`), code: err.problem }, { status })
    }
    console.error('[admin.organizations] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
