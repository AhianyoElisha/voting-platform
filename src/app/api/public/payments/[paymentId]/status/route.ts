import { getPayment } from '@/lib/votes-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ paymentId: string }> }

/**
 * GET /api/public/payments/[paymentId]/status
 * Polled by the vote page while the payer approves the MoMo prompt. Payment
 * ids are not secrets (a timestamp plus 28 non-cryptographic random bits), so
 * this returns nothing worth guessing for: only whether the payment went
 * through and when. No phone, no amounts, no tickets (those need the buyer's
 * key, see ../tickets/route.ts).
 */
export async function GET(_req: Request, { params }: Params) {
  const { paymentId } = await params
  const payment = await getPayment(paymentId)
  if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(
    { id: payment.$id, status: payment.status, confirmedAt: payment.confirmedAt },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
