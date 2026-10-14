import { NextResponse } from 'next/server'
import { formatPesewas } from './money'
import { PayoutError } from './payouts-server'
import type { PayoutDoc } from './types'

export function payoutErrorResponse(err: unknown, t: (key: string) => string): NextResponse | null {
  if (err instanceof PayoutError) {
    return NextResponse.json(
      { error: t(`errors:payout.${err.problem}`), code: err.problem },
      { status: err.problem === 'badTransition' ? 409 : 400 }
    )
  }
  return null
}

export function payoutView(p: PayoutDoc & { $id: string; $createdAt: string }, organizationName?: string) {
  return {
    id: p.$id,
    organizationId: p.organizationId,
    organizationName: organizationName ?? null,
    amount: p.amount,
    amountLabel: formatPesewas(p.amount),
    destinationKind: p.destinationKind,
    destination: JSON.parse(p.destination) as unknown,
    status: p.status,
    note: p.note,
    requestedAt: p.$createdAt,
    decidedAt: p.decidedAt,
    paidAt: p.paidAt,
  }
}
