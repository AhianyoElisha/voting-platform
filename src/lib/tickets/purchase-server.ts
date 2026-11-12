import { ID, Query } from 'node-appwrite'
import { createAdminClient, withRetry } from '../appwrite-server'
import { APPWRITE, TICKET_QUANTITY_MAX_PLACEHOLDER } from '../constants'
import { databaseId, getOrganization, listTenantDocuments, type TenantContext } from '../db'
import { FeesNotConfiguredError, effectiveCommissionBps, splitAmount } from '../fees'
import { normalizeEmail } from '../nominees-server'
import { PaymentProviderNotConfiguredError, getPaymentProvider, type PaymentProvider } from '../payments'
import { normalizeGhanaPhone } from '../phone'
import { rateLimit } from '../rate-limit'
import type { EventDoc, PaymentDoc, TicketDoc, TicketTierDoc } from '../types'
import {
  INITIATIONS_PER_PHONE_PER_MINUTE,
  VoteError,
  getPayment,
  startProviderDebit,
  type VoteProblem,
} from '../votes-server'
import { verifyPaymentAccessKey } from './token'

/**
 * Ticket purchase (PRD 5.4b), web path. Same shape as a vote: validate,
 * create the Payment as `pending` (rule 1), ask the provider to debit. The
 * tickets themselves appear only when the verified callback confirms the
 * payment (rule 2), in `confirmTicketPayment`.
 */
export type TicketProblem =
  | VoteProblem
  | 'ticketsNotConfigured'
  | 'tierNotFound'
  | 'tierHidden'
  | 'salesClosed'
  | 'soldOut'
  | 'emailInvalid'
  | 'nameTooLong'

export class TicketError extends Error {
  constructor(public readonly problem: TicketProblem) {
    super(`Ticket: ${problem}`)
    this.name = 'TicketError'
  }
}

export interface InitiateTicketInput {
  tierId: string
  quantity: unknown
  phone: string
  email?: string
  name?: string
}

/** Pending payments for this tier in the last ten minutes count as reservations (soft; see the oversell audit). */
export const RESERVATION_WINDOW_MS = 10 * 60 * 1000

export async function availableNow(ctx: TenantContext, tier: TicketTierDoc, now: Date): Promise<number | null> {
  if (tier.quantityAvailable === null) return null
  const since = new Date(now.getTime() - RESERVATION_WINDOW_MS).toISOString()
  const pending = await listTenantDocuments<PaymentDoc>(ctx, APPWRITE.TABLES.PAYMENTS, [
    Query.equal('tierId', [tier.$id]),
    Query.equal('status', ['pending']),
    Query.greaterThan('$createdAt', since),
    Query.limit(500),
  ])
  const reserved = pending.documents.reduce((sum, p) => sum + p.quantity, 0)
  return Math.max(0, tier.quantityAvailable - tier.quantitySold - reserved)
}

export function parseTicketQuantity(input: unknown): number {
  const n = typeof input === 'string' ? Number(input.trim()) : input
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > TICKET_QUANTITY_MAX_PLACEHOLDER)
    throw new TicketError('quantityInvalid')
  return n
}

export async function initiateTicketPayment(
  input: InitiateTicketInput,
  opts: { provider?: PaymentProvider; now?: Date } = {}
): Promise<{ payment: PaymentDoc; tier: TicketTierDoc; event: EventDoc; instructions?: string }> {
  const now = opts.now ?? new Date()
  // The QR token is signed at confirmation; refuse now rather than strand a paid buyer later.
  if (!process.env.TICKET_SECRET) throw new TicketError('ticketsNotConfigured')
  const quantity = parseTicketQuantity(input.quantity)
  const payerPhone = normalizeGhanaPhone(input.phone ?? '')
  if (!payerPhone) throw new TicketError('phoneInvalid')
  let payerEmail: string | null
  try {
    payerEmail = normalizeEmail(input.email)
  } catch {
    throw new TicketError('emailInvalid')
  }
  const payerName = (input.name ?? '').trim().replace(/\s+/g, ' ') || null
  if (payerName && payerName.length > 120) throw new TicketError('nameTooLong')

  if (!rateLimit(`initiate:phone:${payerPhone}`, INITIATIONS_PER_PHONE_PER_MINUTE, 60_000, now.getTime()).ok) {
    throw new TicketError('rateLimited')
  }

  const { databases } = createAdminClient()
  let tier: TicketTierDoc
  try {
    tier = await withRetry(() =>
      databases.getDocument<TicketTierDoc>(databaseId(), APPWRITE.TABLES.TICKET_TIERS, input.tierId ?? '')
    )
  } catch (err) {
    if ((err as { code?: number })?.code === 404) throw new TicketError('tierNotFound')
    throw err
  }
  if (tier.status !== 'active') throw new TicketError('tierHidden')
  const ctx: TenantContext = { organizationId: tier.organizationId, userId: 'public', role: 'scanner' }
  const organization = await getOrganization(tier.organizationId)
  if (!organization || organization.status !== 'active') throw new TicketError('organizationInactive')
  const event = await withRetry(() =>
    databases.getDocument<EventDoc>(databaseId(), APPWRITE.TABLES.EVENTS, tier.eventId)
  )
  if (event.organizationId !== tier.organizationId) throw new TicketError('tierNotFound')
  if (event.status === 'draft' || event.status === 'closed') throw new TicketError('salesClosed')
  if ((tier.salesStart && now < new Date(tier.salesStart)) || (tier.salesEnd && now > new Date(tier.salesEnd)))
    throw new TicketError('salesClosed')
  const available = await availableNow(ctx, tier, now)
  if (available !== null && quantity > available) throw new TicketError('soldOut')

  let bps: number
  try {
    bps = effectiveCommissionBps(organization.commissionRate)
  } catch (err) {
    if (err instanceof FeesNotConfiguredError) throw new TicketError('feesNotConfigured')
    throw err
  }
  const amount = tier.price * quantity
  if (!Number.isSafeInteger(amount)) throw new TicketError('quantityInvalid')
  const { platformFee, organizerNet } = splitAmount(amount, bps)

  let provider: PaymentProvider
  try {
    provider = opts.provider ?? getPaymentProvider()
  } catch (err) {
    if (err instanceof PaymentProviderNotConfiguredError) throw new TicketError('providerNotConfigured')
    throw err
  }

  const paymentId = ID.unique()
  const payment = await withRetry(() =>
    databases.createDocument<PaymentDoc>(databaseId(), APPWRITE.TABLES.PAYMENTS, paymentId, {
      organizationId: tier.organizationId,
      eventId: event.$id,
      roundId: null,
      nomineeId: null,
      tierId: tier.$id,
      payerName,
      channel: 'web',
      purpose: 'ticket',
      payerPhone,
      payerEmail,
      network: null,
      quantity,
      amount,
      platformFee,
      organizerNet,
      provider: provider.name,
      providerReference: `local_${paymentId}`,
      status: 'pending',
      confirmedAt: null,
      rawCallback: null,
    })
  )
  try {
    const started = await startProviderDebit(payment, provider, `${quantity} × ${tier.name}, ${event.title}`)
    return { payment: started.payment, tier, event, instructions: started.instructions }
  } catch (err) {
    if (err instanceof VoteError) throw new TicketError(err.problem)
    throw err
  }
}

export interface BuyerTickets {
  status: PaymentDoc['status']
  tierName: string
  tickets: { id: string; token: string; status: TicketDoc['status'] }[]
}

/**
 * What the buyer's page polls for after paying: the purchase's tickets, once
 * the payment is confirmed. Null (a 404) unless `accessKey` is the key handed
 * to the buyer at initiation; checked before any read, so a guessed or
 * ticket-derived payment id learns nothing, not even whether it exists.
 */
export async function buyerTickets(paymentId: string, accessKey: string | null): Promise<BuyerTickets | null> {
  if (!verifyPaymentAccessKey(paymentId, accessKey)) return null
  const payment = await getPayment(paymentId)
  if (!payment || payment.purpose !== 'ticket') return null
  if (payment.status !== 'success') return { status: payment.status, tierName: '', tickets: [] }
  const { databases } = createAdminClient()
  const [tickets, tier] = await Promise.all([
    withRetry(() =>
      databases.listDocuments<TicketDoc>(databaseId(), APPWRITE.TABLES.TICKETS, [
        Query.equal('paymentId', [paymentId]),
        Query.limit(100),
      ])
    ),
    payment.tierId
      ? withRetry(() =>
          databases.getDocument<TicketTierDoc>(databaseId(), APPWRITE.TABLES.TICKET_TIERS, payment.tierId as string)
        ).catch(() => null)
      : null,
  ])
  return {
    status: payment.status,
    tierName: tier?.name ?? '',
    tickets: tickets.documents.map((t) => ({ id: t.$id, token: t.qrToken, status: t.status })),
  }
}
