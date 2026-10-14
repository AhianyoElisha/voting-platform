import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { downloadFlyer, flyersForEvent } from '@/lib/flyer/generate-server'
import { zipSync } from 'fflate'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string }> }

/** GET: every generated flyer for the event in one ZIP, named by nominee code and name. */
export async function GET(_req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    const rows = (await flyersForEvent(r.ctx, eventId)).slice(0, 200)
    const entries: Record<string, Uint8Array> = {}
    for (const { flyer, nominee } of rows) {
      const safe = nominee.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
      entries[`${nominee.code}-${safe || 'nominee'}.png`] = await downloadFlyer(flyer.fileId)
    }
    const zip = zipSync(entries, { level: 0 })
    return new NextResponse(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="flyers-${eventId}.zip"`,
      },
    })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'flyers.zip')
  }
}
