import { getTranslations } from '@/lib/i18n-server'
import { rateLimit } from '@/lib/rate-limit'
import { ticketErrorResponse } from '@/lib/tickets/api'
import { initiateTicketPayment } from '@/lib/tickets/purchase-server'
import { paymentAccessKey } from '@/lib/tickets/token'
import { NextResponse } from 'next/server'

/** POST { tierId, quantity, phone, email?, name? }: pending Payment plus the MoMo prompt. Tickets come from the verified callback. */
export async function POST(req: Request) {
  const { t } = await getTranslations()
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`initiate:ip:${ip}`, 20, 60_000).ok) {
    return NextResponse.json(
      { error: t('errors:vote.rateLimited'), code: 'rateLimited' },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }
  try {
    const { payment, tier, event, instructions } = await initiateTicketPayment({
      tierId: typeof body?.tierId === 'string' ? body.tierId : '',
      quantity: body?.quantity,
      phone: typeof body?.phone === 'string' ? body.phone : '',
      email: typeof body?.email === 'string' ? body.email : undefined,
      name: typeof body?.name === 'string' ? body.name : undefined,
    })
    return NextResponse.json(
      {
        payment: {
          id: payment.$id,
          // The buyer's key to the tickets; only this response carries it.
          accessKey: paymentAccessKey(payment.$id),
          status: payment.status,
          amount: payment.amount,
          quantity: payment.quantity,
        },
        tier: { name: tier.name },
        event: { title: event.title },
        instructions: instructions ?? null,
      },
      { status: 201 }
    )
  } catch (err) {
    const mapped = ticketErrorResponse(err, t)
    if (mapped) return mapped
    console.error('[tickets.initiate] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
