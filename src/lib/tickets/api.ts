import { NextResponse } from 'next/server'
import { TicketError } from './purchase-server'
import { TierError } from './tiers-server'

export function ticketErrorResponse(err: unknown, t: (key: string) => string): NextResponse | null {
  if (err instanceof TierError)
    return NextResponse.json({ error: t(`errors:tier.${err.problem}`), code: err.problem }, { status: 400 })
  if (err instanceof TicketError) {
    const status =
      err.problem === 'feesNotConfigured' ||
      err.problem === 'providerNotConfigured' ||
      err.problem === 'ticketsNotConfigured'
        ? 503
        : err.problem === 'providerFailed'
          ? 502
          : err.problem === 'rateLimited'
            ? 429
            : err.problem === 'tierNotFound'
              ? 404
              : 400
    return NextResponse.json({ error: t(`errors:ticket.${err.problem}`), code: err.problem }, { status })
  }
  return null
}

export function tierView(tier: {
  $id: string
  name: string
  price: number
  quantityAvailable: number | null
  quantitySold: number
  salesStart: string | null
  salesEnd: string | null
  status: string
  order: number
}) {
  return {
    id: tier.$id,
    name: tier.name,
    price: tier.price,
    quantityAvailable: tier.quantityAvailable,
    quantitySold: tier.quantitySold,
    salesStart: tier.salesStart,
    salesEnd: tier.salesEnd,
    status: tier.status,
    order: tier.order,
  }
}
