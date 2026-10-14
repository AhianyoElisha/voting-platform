import { domainErrorResponse, readJson, str, withTenant } from '@/lib/api-tenant'
import { APPWRITE } from '@/lib/constants'
import { flyerErrorResponse, templateView } from '@/lib/flyer/api'
import { createTemplate, fileViewUrl, listTemplates } from '@/lib/flyer/templates-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    const templates = await listTemplates(r.ctx, eventId)
    return NextResponse.json({
      templates: templates.map((t) =>
        templateView(t, t.backgroundFileId ? fileViewUrl(APPWRITE.BUCKETS.FLYER_TEMPLATES, t.backgroundFileId) : null)
      ),
    })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'templates.list')
  }
}

export async function POST(req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    const t = await createTemplate(r.ctx, eventId, { name: str(body.name), categoryId: str(body.categoryId) || null })
    return NextResponse.json({ template: templateView(t, null) }, { status: 201 })
  } catch (err) {
    return flyerErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'templates.create')
  }
}
