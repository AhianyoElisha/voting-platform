import { getTranslations } from '@/lib/i18n-server'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { VoteError, initiateVotePayment } from '@/lib/votes-server'
import { NextResponse } from 'next/server'

/**
 * POST /api/public/votes/initiate  { code, quantity, phone }
 *
 * Public, no session. Creates the pending Payment and asks the provider to
 * start the MoMo debit. Nothing here counts a vote (rule 2); the callback
 * route does, after verification.
 */
export async function POST(req: Request) {
  const { t } = await getTranslations()
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const code = typeof body?.code === 'string' ? body.code : ''
  const phone = typeof body?.phone === 'string' ? body.phone : ''
  const quantity = body?.quantity

  // Limits are #27 placeholders. By client IP here; the per-phone budget
  // lives in initiateVotePayment so USSD shares it.
  const ip = clientIp(req.headers)
  const byIp = await rateLimit(`initiate:ip:${ip}`, 20, 60_000)
  if (!byIp.ok) {
    const retry = Math.ceil(byIp.retryAfterMs / 1000)
    return NextResponse.json(
      { error: t('errors:vote.rateLimited'), code: 'rateLimited' },
      { status: 429, headers: { 'Retry-After': String(retry) } }
    )
  }

  try {
    const { payment, instructions, nextAction, nominee, event } = await initiateVotePayment({
      code,
      quantity,
      phone,
      channel: 'web',
      // What the page showed; refused if the price has changed since (a new round opened).
      expectedAmount: typeof body?.amount === 'number' ? body.amount : undefined,
    })
    return NextResponse.json(
      {
        payment: {
          id: payment.$id,
          status: payment.status,
          amount: payment.amount,
          quantity: payment.quantity,
          providerReference: payment.providerReference,
        },
        nominee: { name: nominee.name, code: nominee.code },
        event: { title: event.title },
        instructions: instructions ?? null,
        nextAction: nextAction ?? null,
      },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof VoteError) {
      const status =
        err.problem === 'feesNotConfigured' || err.problem === 'providerNotConfigured'
          ? 503
          : err.problem === 'providerFailed'
            ? 502
            : err.problem === 'rateLimited'
              ? 429
              : 400
      return NextResponse.json(
        { error: t(`errors:vote.${err.problem}`), code: err.problem },
        { status, headers: status === 429 ? { 'Retry-After': '60' } : undefined }
      )
    }
    console.error('[votes.initiate] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
