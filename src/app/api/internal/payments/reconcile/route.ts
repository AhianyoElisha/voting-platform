import { isAuthorizedJobRequest } from '@/lib/internal-auth'
import { pruneRateLimits } from '@/lib/rate-limit'
import { reconcilePendingPayments } from '@/lib/votes-server'
import { NextResponse } from 'next/server'

/**
 * Payment reconciliation (USSD_AND_PAYMENTS.md rule 5): re-check stale
 * `pending` payments against the provider so a missed callback never loses
 * a paid vote or ticket. Safe to run often: settled payments are no-ops.
 *
 * Called by the Vercel cron declared in `vercel.json` (GET with the
 * `CRON_SECRET` bearer token, decision #24) or by hand with the
 * `x-internal-secret` header (POST or GET).
 *
 * Also deletes expired rate-limit windows (`src/lib/rate-limit.ts`), best
 * effort, so that table stays small without a cron of its own.
 */
async function run(req: Request) {
  if (!isAuthorizedJobRequest(req.headers)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const totals = await reconcilePendingPayments()
    let rateLimitRowsPruned: number | null = null
    try {
      rateLimitRowsPruned = await pruneRateLimits()
    } catch (err) {
      console.warn('[payments.reconcile] could not prune rate limits', err)
    }
    return NextResponse.json({ ...totals, rateLimitRowsPruned })
  } catch (err) {
    console.error('[payments.reconcile] Error:', err)
    return NextResponse.json({ error: 'Reconciliation failed' }, { status: 500 })
  }
}

export const GET = run
export const POST = run
