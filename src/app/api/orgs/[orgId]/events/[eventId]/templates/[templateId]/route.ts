import { domainErrorResponse, readJson, withTenant } from '@/lib/api-tenant'
import { APPWRITE } from '@/lib/constants'
import { flyerErrorResponse, templateView } from '@/lib/flyer/api'
import { fileViewUrl, getTemplate, saveTemplateModel, unpublishTemplate } from '@/lib/flyer/templates-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string; templateId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { orgId, eventId, templateId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    const t = await getTemplate(r.ctx, templateId, eventId)
    return NextResponse.json({
      template: templateView(
        t,
        t.backgroundFileId ? fileViewUrl(APPWRITE.BUCKETS.FLYER_TEMPLATES, t.backgroundFileId) : null
      ),
    })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'templates.get')
  }
}

/** PUT { model, name? } saves the slot model. PATCH { status: 'draft' } unpublishes. */
export async function PUT(req: Request, { params }: Params) {
  const { orgId, eventId, templateId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    await getTemplate(r.ctx, templateId, eventId)
    const t = await saveTemplateModel(
      r.ctx,
      templateId,
      body.model,
      typeof body.name === 'string' ? body.name : undefined
    )
    return NextResponse.json({
      template: templateView(
        t,
        t.backgroundFileId ? fileViewUrl(APPWRITE.BUCKETS.FLYER_TEMPLATES, t.backgroundFileId) : null
      ),
    })
  } catch (err) {
    return flyerErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'templates.save')
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const { orgId, eventId, templateId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const body = await readJson(req)
  try {
    if (body.status !== 'draft')
      return NextResponse.json({ error: 'Only unpublishing is supported here' }, { status: 400 })
    await getTemplate(r.ctx, templateId, eventId)
    const t = await unpublishTemplate(r.ctx, templateId)
    return NextResponse.json({ template: templateView(t, null) })
  } catch (err) {
    return flyerErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'templates.unpublish')
  }
}
