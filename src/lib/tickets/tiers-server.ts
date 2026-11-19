import { Query } from 'node-appwrite'
import { APPWRITE } from '../constants'
import {
  createTenantDocument,
  getTenantDocument,
  listTenantDocuments,
  updateTenantDocument,
  type TenantContext,
} from '../db'
import { InvalidAmountError, cedisToPesewas, isPesewas } from '../money'
import { assertCanManage } from '../tenant'
import type { EventDoc, PaymentDoc, TicketDoc, TicketTierDoc } from '../types'

/** Ticket tiers (PRD 5.4b). Prices in pesewas; forms send cedis and convert here. */
export type TierProblem =
  'nameTooShort' | 'nameTooLong' | 'priceInvalid' | 'quantityInvalid' | 'datesInvalid' | 'eventClosed'

export class TierError extends Error {
  constructor(public readonly problem: TierProblem) {
    super(`Tier: ${problem}`)
    this.name = 'TierError'
  }
}

export interface TierInput {
  name: string
  priceCedis?: string
  price?: number
  /** Empty or null means unlimited. */
  quantityAvailable?: number | null
  salesStart?: string | null
  salesEnd?: string | null
  status?: 'active' | 'hidden'
}

export function normalizeTierInput(
  input: TierInput
): Omit<TicketTierDoc, keyof import('../types').TenantDoc | 'eventId' | 'quantitySold' | 'order'> {
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ')
  if (name.length < 2) throw new TierError('nameTooShort')
  if (name.length > 80) throw new TierError('nameTooLong')
  let price: number
  if (input.price !== undefined) {
    if (!isPesewas(input.price)) throw new TierError('priceInvalid')
    price = input.price
  } else {
    try {
      price = cedisToPesewas(input.priceCedis ?? '')
    } catch (err) {
      if (err instanceof InvalidAmountError) throw new TierError('priceInvalid')
      throw err
    }
  }
  // Free tickets are a separate feature (like free votes, OPEN_QUESTIONS #7): a zero price would send
  // a zero debit to the provider and issue a ticket no payment confirmed.
  if (price <= 0) throw new TierError('priceInvalid')
  const q = input.quantityAvailable
  if (q !== null && q !== undefined && (!Number.isInteger(q) || q < 0 || q > 1_000_000))
    throw new TierError('quantityInvalid')
  const salesStart = input.salesStart ? new Date(input.salesStart) : null
  const salesEnd = input.salesEnd ? new Date(input.salesEnd) : null
  if ((salesStart && Number.isNaN(salesStart.getTime())) || (salesEnd && Number.isNaN(salesEnd.getTime())))
    throw new TierError('datesInvalid')
  if (salesStart && salesEnd && salesEnd <= salesStart) throw new TierError('datesInvalid')
  return {
    name,
    price,
    quantityAvailable: q === undefined ? null : q,
    salesStart: salesStart ? salesStart.toISOString() : null,
    salesEnd: salesEnd ? salesEnd.toISOString() : null,
    status: input.status === 'hidden' ? 'hidden' : 'active',
  }
}

export async function listTiers(ctx: TenantContext, eventId: string): Promise<TicketTierDoc[]> {
  const res = await listTenantDocuments<TicketTierDoc>(ctx, APPWRITE.TABLES.TICKET_TIERS, [
    Query.equal('eventId', [eventId]),
    Query.orderAsc('order'),
    Query.limit(50),
  ])
  return res.documents
}

export async function createTier(ctx: TenantContext, eventId: string, input: TierInput): Promise<TicketTierDoc> {
  assertCanManage(ctx)
  const event = await getTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, eventId)
  if (event.status === 'closed') throw new TierError('eventClosed')
  const data = normalizeTierInput(input)
  const existing = await listTiers(ctx, eventId)
  const order = existing.reduce((m, t) => Math.max(m, t.order), 0) + 1
  return createTenantDocument<TicketTierDoc>(ctx, APPWRITE.TABLES.TICKET_TIERS, {
    ...data,
    eventId,
    quantitySold: 0,
    order,
  })
}

export async function updateTier(
  ctx: TenantContext,
  tierId: string,
  input: Partial<TierInput>
): Promise<TicketTierDoc> {
  assertCanManage(ctx)
  const tier = await getTenantDocument<TicketTierDoc>(ctx, APPWRITE.TABLES.TICKET_TIERS, tierId)
  const merged = normalizeTierInput({
    name: input.name ?? tier.name,
    price: input.price ?? (input.priceCedis === undefined ? tier.price : undefined),
    priceCedis: input.priceCedis,
    quantityAvailable: input.quantityAvailable === undefined ? tier.quantityAvailable : input.quantityAvailable,
    salesStart: input.salesStart === undefined ? tier.salesStart : input.salesStart,
    salesEnd: input.salesEnd === undefined ? tier.salesEnd : input.salesEnd,
    status: input.status ?? tier.status,
  })
  return updateTenantDocument<TicketTierDoc>(ctx, APPWRITE.TABLES.TICKET_TIERS, tierId, merged)
}

/** For the public page: active tiers of an active organization's event. */
export async function listPublicTiers(organizationId: string, eventId: string): Promise<TicketTierDoc[]> {
  const ctx: TenantContext = { organizationId, userId: 'public', role: 'scanner' }
  const res = await listTenantDocuments<TicketTierDoc>(ctx, APPWRITE.TABLES.TICKET_TIERS, [
    Query.equal('eventId', [eventId]),
    Query.equal('status', ['active']),
    Query.orderAsc('order'),
    Query.limit(50),
  ])
  return res.documents
}

export interface TicketFigures {
  ticketsSold: number
  ticketsUsed: number
  gross: number
  /** Payment provider charges taken off the gross (decision #36). */
  charges: number
  platformShare: number
  organizerShare: number
}

export async function ticketFigures(ctx: TenantContext, eventId: string): Promise<TicketFigures> {
  const [payments, tickets] = await Promise.all([
    listTenantDocuments<PaymentDoc>(ctx, APPWRITE.TABLES.PAYMENTS, [
      Query.equal('eventId', [eventId]),
      Query.equal('status', ['success']),
      Query.equal('purpose', ['ticket']),
      Query.limit(5000),
    ]),
    listTenantDocuments<TicketDoc>(ctx, APPWRITE.TABLES.TICKETS, [
      Query.equal('eventId', [eventId]),
      Query.limit(5000),
    ]),
  ])
  const f: TicketFigures = { ticketsSold: 0, ticketsUsed: 0, gross: 0, charges: 0, platformShare: 0, organizerShare: 0 }
  for (const p of payments.documents) {
    f.ticketsSold += p.quantity
    f.gross += p.amount
    f.charges += p.providerFee ?? 0
    f.platformShare += p.platformFee
    f.organizerShare += p.organizerNet
  }
  f.ticketsUsed = tickets.documents.filter((t) => t.status === 'used').length
  return f
}

export async function listTickets(ctx: TenantContext, eventId: string): Promise<TicketDoc[]> {
  const res = await listTenantDocuments<TicketDoc>(ctx, APPWRITE.TABLES.TICKETS, [
    Query.equal('eventId', [eventId]),
    Query.orderDesc('$createdAt'),
    Query.limit(1000),
  ])
  return res.documents
}
