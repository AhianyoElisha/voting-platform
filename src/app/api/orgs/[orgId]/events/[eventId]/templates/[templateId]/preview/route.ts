import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { createAdminClient, withRetry } from '@/lib/appwrite-server'
import { APPWRITE } from '@/lib/constants'
import { flyerErrorResponse } from '@/lib/flyer/api'
import { SAMPLE_CONTEXT } from '@/lib/flyer/bindings'
import { parseModel } from '@/lib/flyer/model'
import { renderFlyer, solidPng } from '@/lib/flyer/render'
import { getTemplate, listFonts } from '@/lib/flyer/templates-server'
import fs from 'fs/promises'
import { NextResponse } from 'next/server'
import os from 'os'
import path from 'path'

type Params = { params: Promise<{ orgId: string; eventId: string; templateId: string }> }

/** GET: a PNG of the template rendered with a sample nominee. Accepts `?model=` (URL-encoded JSON) to preview unsaved edits. */
export async function GET(req: Request, { params }: Params) {
  const { orgId, eventId, templateId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    const t = await getTemplate(r.ctx, templateId, eventId)
    const url = new URL(req.url)
    const raw = url.searchParams.get('model')
    const model = parseModel(raw ?? t.canvasJson, t.width, t.height)
    const { storage } = createAdminClient()
    const image = async (id: string | null | undefined) =>
      id ? new Uint8Array(await withRetry(() => storage.getFileDownload(APPWRITE.BUCKETS.FLYER_TEMPLATES, id))) : null
    const [background, foreground, photoMask] = await Promise.all([
      image(t.backgroundFileId),
      image(t.foregroundFileId),
      image(t.photoMaskFileId),
    ])
    const families = new Set(model.slots.flatMap((s) => (s.type === 'text' ? [s.fontFamily] : [])))
    const fonts = (await listFonts(r.ctx.organizationId)).filter((f) => families.has(f.family))
    const dir = path.join(os.tmpdir(), 'voteapp-fonts')
    await fs.mkdir(dir, { recursive: true })
    const fontFiles = []
    for (const font of fonts) {
      const file = path.join(dir, `${font.fileId}.bin`)
      try {
        await fs.access(file)
      } catch {
        await fs.writeFile(
          file,
          new Uint8Array(await withRetry(() => storage.getFileDownload(APPWRITE.BUCKETS.FONTS, font.fileId)))
        )
      }
      fontFiles.push({ family: font.family, path: file })
    }
    const png = await renderFlyer({
      width: t.width,
      height: t.height,
      background,
      foreground,
      photoMask,
      photo: solidPng(600, 800, '#6b7280'),
      model,
      context: {
        ...SAMPLE_CONTEXT,
        ussdShortcode: process.env.USSD_SHORTCODE ?? null,
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
      },
      fonts: fontFiles,
    })
    return new NextResponse(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    return flyerErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'templates.preview')
  }
}
