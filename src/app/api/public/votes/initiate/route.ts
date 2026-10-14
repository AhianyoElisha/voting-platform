import { getTranslations } from '@/lib/i18n-server'
import { normalizeGhanaPhone } from '@/lib/phone'
import { rateLimit } from '@/lib/rate-limit'
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

  // PLACEHOLDER (#27): per-instance limits by client IP and by phone.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const byIp = rateLimit(`initiate:ip:${ip}`, 20, 60_000)
  const byPhone = rateLimit(`initiate:phone:${normalizeGhanaPhone(phone) ?? phone.replace(/\D/g, '')}`, 6, 60_000)
  if (!byIp.ok || !byPhone.ok) {
    const retry = Math.ceil(Math.max(byIp.retryAfterMs, byPhone.retryAfterMs) / 1000)
    return NextResponse.json(
      { error: t('errors:vote.rateLimited'), code: 'rateLimited' },
      { status: 429, headers: { 'Retry-After': String(retry) } }
    )
  }

  try {
    const { payment, instructions, nominee, event } = await initiateVotePayment({
      code,
      quantity,
      phone,
      channel: 'web',
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
            : 400
      return NextResponse.json({ error: t(`errors:vote.${err.problem}`), code: err.problem }, { status })
    }
    console.error('[votes.initiate] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
