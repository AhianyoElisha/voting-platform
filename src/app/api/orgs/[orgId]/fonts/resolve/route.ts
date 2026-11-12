import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { flyerErrorResponse } from '@/lib/flyer/api'
import { resolveFonts } from '@/lib/flyer/font-resolve-server'
import { rateLimit } from '@/lib/rate-limit'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string }> }

/**
 * POST { names: string[] } (PostScript font names from a PSD's text slots).
 * Designers and above. Fetches missing Google fonts into the platform library,
 * so it is rate-limited per organization.
 */
export async function POST(req: Request, { params }: Params) {
  const { orgId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  if (!(await rateLimit(`fonts-resolve:${r.ctx.organizationId}`, 20, 60_000)).ok) {
    return NextResponse.json({ error: r.t('errors:vote.rateLimited'), code: 'rateLimited' }, { status: 429 })
  }
  const body = (await req.json().catch(() => null)) as { names?: unknown } | null
  const names = Array.isArray(body?.names) ? body.names.filter((n): n is string => typeof n === 'string') : []
  try {
    return NextResponse.json({ fonts: await resolveFonts(r.ctx, names) })
  } catch (err) {
    return flyerErrorResponse(err, r.t) ?? domainErrorResponse(err, r.t, 'fonts.resolve')
  }
}
