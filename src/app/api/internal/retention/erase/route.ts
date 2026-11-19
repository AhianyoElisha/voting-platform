import { isAuthorizedJobRequest } from '@/lib/internal-auth'
import { erasePersonalData } from '@/lib/retention-server'
import { NextResponse } from 'next/server'

/**
 * The 90-day erasure of payers' and buyers' personal details (decision #28,
 * `src/lib/retention-server.ts`), plus pruning of old USSD session rows.
 *
 * Called daily by the Vercel cron in `vercel.json` (GET with the
 * `CRON_SECRET` bearer token) or by hand with the `x-internal-secret` header.
 * Bounded per run and idempotent, so a run that stops early is finished by
 * the next one.
 */
async function run(req: Request) {
  if (!isAuthorizedJobRequest(req.headers)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await erasePersonalData())
  } catch (err) {
    console.error('[retention.erase] Error:', err)
    return NextResponse.json({ error: 'Erasure failed' }, { status: 500 })
  }
}

export const GET = run
export const POST = run
