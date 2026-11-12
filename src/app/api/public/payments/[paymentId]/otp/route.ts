import { getTranslations } from '@/lib/i18n-server'
import { rateLimit } from '@/lib/rate-limit'
import { VoteError, submitPaymentOtp } from '@/lib/votes-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ paymentId: string }> }

/**
 * POST /api/public/payments/[paymentId]/otp  { otp }
 *
 * The one-time code some mobile networks send before the MoMo prompt
 * (Paystack's `send_otp`). Shared by the vote and ticket pages. It only
 * continues the provider's charge; nothing is confirmed here (rule 2), so a
 * guessed payment id gains nothing without the payer's SMS.
 */
export async function POST(req: Request, { params }: Params) {
  const { paymentId } = await params
  const { t } = await getTranslations()
  // PLACEHOLDER (#27): per-instance limits, like the initiate routes.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`otp:ip:${ip}`, 20, 60_000).ok || !rateLimit(`otp:payment:${paymentId}`, 5, 15 * 60_000).ok) {
    return NextResponse.json(
      { error: t('errors:vote.rateLimited'), code: 'rateLimited' },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  try {
    const out = await submitPaymentOtp(paymentId, body?.otp)
    return NextResponse.json(
      { instructions: out.instructions ?? null, nextAction: out.nextAction ?? null },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    if (err instanceof VoteError) {
      const status = err.problem === 'providerNotConfigured' ? 503 : err.problem === 'paymentNotPending' ? 409 : 400
      return NextResponse.json({ error: t(`errors:vote.${err.problem}`), code: err.problem }, { status })
    }
    console.error('[payments.otp] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
