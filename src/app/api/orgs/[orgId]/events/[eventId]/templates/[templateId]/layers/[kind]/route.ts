import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { APPWRITE } from '@/lib/constants'
import { flyerErrorResponse, templateView } from '@/lib/flyer/api'
import { fileViewUrl, getTemplate, setTemplateLayer, type TemplateLayerKind } from '@/lib/flyer/templates-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string; templateId: string; kind: string }> }

const KINDS: TemplateLayerKind[] = ['foreground', 'photoMask']

async function handle(req: Request, { params }: Params, image: 'read' | 'clear') {
  const { orgId, eventId, templateId, kind } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const layer = KINDS.find((k) => k === kind)
  if (!layer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let bytes: Uint8Array | null = null
  if (image === 'read') {
    const form = await req.formData().catch(() => null)
    const file = form?.get('image')
    if (!(file instanceof File) || file.size === 0 || file.size > 30 * 1024 * 1024) {
      return NextResponse.json({ error: r.t('errors:template.badImage'), code: 'badImage' }, { status: 400 })
    }
    bytes = new Uint8Array(await file.arrayBuffer())
  }
  try {
    await getTemplate(r.ctx, templateId, eventId)
    const t = await setTemplateLayer(r.ctx, templateId, layer, bytes)
    return NextResponse.json({
      template: templateView(
        t,
        t.backgroundFileId ? fileViewUrl(APPWRITE.BUCKETS.FLYER_TEMPLATES, t.backgroundFileId) : null
      ),
    })
  } catch (err) {
    return flyerErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, `templates.${layer}`)
  }
}

/** POST multipart `image` (PNG with transparency): set the template's foreground or photo mask. */
export function POST(req: Request, ctx: Params) {
  return handle(req, ctx, 'read')
}

/** DELETE: remove it. */
export function DELETE(req: Request, ctx: Params) {
  return handle(req, ctx, 'clear')
}
