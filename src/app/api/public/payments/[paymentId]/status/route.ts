import { getPayment } from '@/lib/votes-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ paymentId: string }> }

/**
 * GET /api/public/payments/[paymentId]/status
 * Polled by the vote page while the payer approves the MoMo prompt. The id is
 * unguessable and only the status comes back; no phone, no amounts.
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
