import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { flyerErrorResponse, templateView } from '@/lib/flyer/api'
import { generateForEvent, type BatchResult } from '@/lib/flyer/generate-server'
import { getTemplate, publishTemplate } from '@/lib/flyer/templates-server'
import { NextResponse, after } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string; templateId: string }> }

/** POST: publish (version bump), then regenerate the event's flyers after the response is sent. */
export async function POST(_req: Request, { params }: Params) {
  const { orgId, eventId, templateId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    await getTemplate(r.ctx, templateId, eventId)
    const t = await publishTemplate(r.ctx, templateId)
    const ctx = r.ctx
    after(async () => {
      // A first pass of up to 30; the organizer's "generate" button finishes larger events.
      let offset: number | null = 0
      for (let i = 0; i < 3 && offset !== null; i++) {
        const batch: BatchResult | null = await generateForEvent(ctx, t.eventId, { offset, limit: 10 }).catch((err) => {
          console.error('[flyer] publish regeneration failed', err)
          return null
        })
        offset = batch?.nextOffset ?? null
      }
    })
    return NextResponse.json({ template: templateView(t, null) })
  } catch (err) {
    return flyerErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'templates.publish')
  }
}
