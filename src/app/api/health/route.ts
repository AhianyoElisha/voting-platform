import { NextResponse } from 'next/server'

/** GET /api/health — liveness check for the host and uptime monitors. */
export function GET() {
  return NextResponse.json({ ok: true, app: 'voteapp' })
}
