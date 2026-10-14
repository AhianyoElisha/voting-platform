import { getPaymentProvider, isMockProviderActive } from '@/lib/payments'
import { handleProviderCallback } from '@/lib/payments/callback'
import { MOCK_SIGNATURE_HEADER, signMockPayload } from '@/lib/payments/mock'
import { getPayment } from '@/lib/votes-server'
import { NextResponse } from 'next/server'

/**
 * POST /api/dev/payments/confirm  { paymentId, status: 'success' | 'failed' }
 *
 * Development only (mock provider): plays the aggregator's part by
 * signing a mock callback and pushing it through the same verification and
 * confirmation path as the real webhook. Disabled unless the mock provider is
 * the active one, which `getPaymentProvider` already refuses in production.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production' || !isMockProviderActive()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId : ''
  const status = body?.status === 'failed' ? 'failed' : 'success'

  const payment = await getPayment(paymentId)
  if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

  const rawBody = JSON.stringify({
    providerReference: payment.providerReference,
    status,
    simulatedAt: new Date().toISOString(),
  })
  const headers = new Headers({ [MOCK_SIGNATURE_HEADER]: signMockPayload(rawBody) })
  const handled = await handleProviderCallback(getPaymentProvider(), headers, rawBody)
  if (!handled.ok) return NextResponse.json({ error: handled.reason }, { status: handled.status })
  return NextResponse.json({ outcome: handled.outcome })
}
