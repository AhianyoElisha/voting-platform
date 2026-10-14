import { PaymentProviderNotConfiguredError, getPaymentProvider } from '@/lib/payments'
import { handleProviderCallback } from '@/lib/payments/callback'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ provider: string }> }

/**
 * POST /api/payments/callback/[provider]
 *
 * The aggregator's webhook. Fast and idempotent (rule 5, "Reliability notes"):
 * verify the signature, apply the result in one transaction, answer. The raw
 * body is read as text so the signature is checked over exactly what was
 * sent. A replay answers 200 `duplicate` so the provider stops retrying.
 */
export async function POST(req: Request, { params }: Params) {
  const { provider: name } = await params
  let provider
  try {
    provider = getPaymentProvider(name)
  } catch (err) {
    if (err instanceof PaymentProviderNotConfiguredError)
      return NextResponse.json({ error: 'Unknown provider' }, { status: 404 })
    throw err
  }

  const rawBody = await req.text()
  try {
    const handled = await handleProviderCallback(provider, req.headers, rawBody)
    if (!handled.ok) return NextResponse.json({ error: 'Unverified callback' }, { status: handled.status })
    return NextResponse.json({ outcome: handled.outcome }, { status: handled.status })
  } catch (err) {
    // A 500 makes the provider retry, which is what we want for transient faults.
    console.error(`[payments.callback.${name}] Error:`, err)
    return NextResponse.json({ error: 'Callback processing failed' }, { status: 500 })
  }
}
