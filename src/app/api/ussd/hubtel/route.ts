import { rateLimit } from '@/lib/rate-limit'
import { handleUssd } from '@/lib/ussd/handler'
import { buildHubtelUssdResponse, parseHubtelUssdRequest } from '@/lib/ussd/hubtel'
import crypto from 'crypto'
import { NextResponse } from 'next/server'

/**
 * POST /api/ussd/hubtel: one call per menu step from Hubtel. Fast, and it
 * never counts a vote; at most it creates a pending Payment through the
 * normal initiation. Guarded by an optional shared secret (Basic auth
 * password or `x-ussd-secret`) and an optional source-IP allowlist, both
 * from env, plus a per-phone rate limit.
 */
function secretOk(req: Request): boolean {
  const expected = process.env.USSD_WEBHOOK_SECRET
  if (!expected) return true
  const auth = req.headers.get('authorization') ?? ''
  let given = req.headers.get('x-ussd-secret') ?? ''
  if (!given && auth.toLowerCase().startsWith('basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
    given = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded
  }
  const enc = new TextEncoder()
  return given.length === expected.length && crypto.timingSafeEqual(enc.encode(given), enc.encode(expected))
}

function ipOk(req: Request): boolean {
  const allow = (process.env.USSD_CALLBACK_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (allow.length === 0) return true
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || ''
  return allow.includes(ip)
}

function guardConfigured(): boolean {
  return !!process.env.USSD_WEBHOOK_SECRET || !!(process.env.USSD_CALLBACK_IPS ?? '').trim()
}

export async function POST(req: Request) {
  // In production the webhook is never open to the world: a secret or an
  // allowlist must exist, or every call is refused.
  if (process.env.NODE_ENV === 'production' && !guardConfigured()) {
    console.error('[ussd.hubtel] refused: set USSD_WEBHOOK_SECRET or USSD_CALLBACK_IPS')
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!secretOk(req) || !ipOk(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => null)
  const input = parseHubtelUssdRequest(body)
  if (!input) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const limited = await rateLimit(`ussd:${input.phone.replace(/\D/g, '')}`, 40, 60_000)
  if (!limited.ok) {
    return NextResponse.json(
      buildHubtelUssdResponse(input.sessionId, { message: 'Too many requests. Try again shortly.', end: true })
    )
  }

  try {
    const output = await handleUssd(input)
    return NextResponse.json(buildHubtelUssdResponse(input.sessionId, output))
  } catch (err) {
    console.error('[ussd.hubtel] Error:', err)
    return NextResponse.json(
      buildHubtelUssdResponse(input.sessionId, { message: 'Service unavailable. Please try again.', end: true })
    )
  }
}
