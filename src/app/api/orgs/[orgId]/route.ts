import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { parseBrandColors } from '@/lib/branding'
import { settingsErrorResponse } from '@/lib/org-settings-api'
import { updateOrganizationProfile } from '@/lib/organizations-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string }> }

/** PATCH { name?, brandColors?: { primary, accent? } | null }. Owners and admins. */
export async function PATCH(req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  try {
    const o = await updateOrganizationProfile(r.ctx, { name: body?.name, brandColors: body?.brandColors })
    return NextResponse.json({ organization: { name: o.name, brandColors: parseBrandColors(o.brandColors) } })
  } catch (err) {
    return settingsErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'organizations.update')
  }
}
