import { reconcilePendingPayments } from '@/lib/votes-server'
import crypto from 'crypto'
import { NextResponse } from 'next/server'

/**
 * POST /api/internal/payments/reconcile
 *
 * Rule 5: re-check stale `pending` payments against the provider so a missed
 * callback never loses a paid vote. Called by a scheduler with the
 * `x-internal-secret` header (the cron itself is wired once hosting, #24, is
 * decided). Safe to run often: settled payments are idempotent no-ops.
 */
export async function POST(req: Request) {
  const expected = process.env.INTERNAL_JOB_SECRET
  const given = req.headers.get('x-internal-secret') ?? ''
  const enc = new TextEncoder()
  if (
    !expected ||
    given.length !== expected.length ||
    !crypto.timingSafeEqual(enc.encode(given), enc.encode(expected))
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const totals = await reconcilePendingPayments()
    return NextResponse.json(totals)
  } catch (err) {
    console.error('[payments.reconcile] Error:', err)
    return NextResponse.json({ error: 'Reconciliation failed' }, { status: 500 })
  }
}
