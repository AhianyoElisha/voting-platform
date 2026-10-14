import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { APPWRITE } from '@/lib/constants'
import { flyerErrorResponse } from '@/lib/flyer/api'
import { fileViewUrl, listFonts, uploadFont } from '@/lib/flyer/templates-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string }> }

function view(f: {
  $id: string
  family: string
  weight: number
  style: string
  fileId: string
  organizationId: string | null
}) {
  return {
    id: f.$id,
    family: f.family,
    weight: f.weight,
    style: f.style,
    url: fileViewUrl(APPWRITE.BUCKETS.FONTS, f.fileId),
    platform: f.organizationId === null,
  }
}

export async function GET(_req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  return NextResponse.json({ fonts: (await listFonts(r.ctx.organizationId)).map(view) })
}

/** POST multipart: `file` (TTF/OTF), `family`, `weight`, `style`. */
export async function POST(req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: r.t('errors:font.badFontFile'), code: 'badFontFile' }, { status: 400 })
  }
  try {
    const font = await uploadFont(r.ctx, {
      family: String(form?.get('family') ?? ''),
      weight: Number(form?.get('weight') ?? 400),
      style: form?.get('style') === 'italic' ? 'italic' : 'normal',
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
    return NextResponse.json({ font: view(font) }, { status: 201 })
  } catch (err) {
    return flyerErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'fonts.upload')
  }
}
