import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { APPWRITE } from '@/lib/constants'
import { flyerErrorResponse, templateView } from '@/lib/flyer/api'
import { fileViewUrl, getTemplate, setTemplateBackground } from '@/lib/flyer/templates-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string; templateId: string }> }

/** POST multipart `background` (PNG or JPEG, up to 30 MB). The image's size becomes the canvas size. */
export async function POST(req: Request, { params }: Params) {
  const { orgId, eventId, templateId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const form = await req.formData().catch(() => null)
  const file = form?.get('background')
  if (!(file instanceof File) || file.size === 0 || file.size > 30 * 1024 * 1024) {
    return NextResponse.json({ error: r.t('errors:template.badImage'), code: 'badImage' }, { status: 400 })
  }
  try {
    await getTemplate(r.ctx, templateId, eventId)
    const t = await setTemplateBackground(r.ctx, templateId, new Uint8Array(await file.arrayBuffer()))
    return NextResponse.json({
      template: templateView(t, fileViewUrl(APPWRITE.BUCKETS.FLYER_TEMPLATES, t.backgroundFileId as string)),
    })
  } catch (err) {
    return flyerErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'templates.background')
  }
}
