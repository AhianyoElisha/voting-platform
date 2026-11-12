import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { settingsErrorResponse } from '@/lib/org-settings-api'
import { LOGO_MAX_BYTES, setOrganizationLogo } from '@/lib/organizations-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string }> }

/** POST multipart `logo` (PNG, JPEG or WebP, up to 5 MB). Owners and admins. */
export async function POST(req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const form = await req.formData().catch(() => null)
  const file = form?.get('logo')
  if (!(file instanceof File) || file.size === 0 || file.size > LOGO_MAX_BYTES) {
    return NextResponse.json({ error: r.t('errors:orgSettings.badImage'), code: 'badImage' }, { status: 400 })
  }
  try {
    const o = await setOrganizationLogo(r.ctx, new Uint8Array(await file.arrayBuffer()))
    return NextResponse.json({ logoUrl: o.logoUrl })
  } catch (err) {
    return settingsErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'organizations.logo')
  }
}

/** DELETE: remove the logo. */
export async function DELETE(_req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    await setOrganizationLogo(r.ctx, null)
    return NextResponse.json({ logoUrl: null })
  } catch (err) {
    return settingsErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'organizations.logo')
  }
}
