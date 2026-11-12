import { ID, Query, type Models } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { writeAuditLog } from './audit'
import { APPWRITE, VOTE_QUANTITY_MAX_PLACEHOLDER, VOTE_QUANTITY_MIN } from './constants'
import { databaseId, getOrganization, listTenantDocuments, runInTransaction, type TenantContext } from './db'
import { FeesNotConfiguredError, effectiveCommissionBps, splitAmount } from './fees'
import { findNomineeByCode } from './nominee-code'
import {
  PaymentProviderNotConfiguredError,
  getPaymentProvider,
  type CallbackResult,
  type PaymentProvider,
} from './payments'
import { normalizeGhanaPhone } from './phone'
import { rateLimit } from './rate-limit'
import type {
  CategoryDoc,
  EventDoc,
  LedgerEntryDoc,
  NomineeDoc,
  OrganizationDoc,
  PaymentDoc,
  RoundDoc,
  RoundEntryDoc,
  TicketDoc,
  TicketTierDoc,
  VoteDoc,
} from './types'

/**
 * The paid-vote pipeline (USSD_AND_PAYMENTS.md "Payment rules", CLAUDE.md
 * rules 3, 3b, 5, 6).
 *
 *   initiateVotePayment  →  Payment `pending`  →  provider.initiate
 *   provider callback / status check  →  confirmPayment  →  one transaction:
 *     Payment `success` + Vote (source=paid) + RoundEntry.voteCount += n
 *     + LedgerEntry credit
 *
 * `confirmPayment` is the only code that creates a paid Vote, and it only
 * accepts a `CallbackResult` that came out of `provider.verifyCallback` or
 * `provider.checkStatus`. Route handlers never build one from a request body.
 */
export type VoteProblem =
  | 'nomineeNotFound'
  | 'nomineeInactive'
  | 'organizationInactive'
  | 'eventNotLive'
  | 'outsideWindow'
  | 'noLiveRound'
  | 'notInRound'
  | 'quantityInvalid'
  | 'phoneInvalid'
  | 'feesNotConfigured'
  | 'providerNotConfigured'
  | 'providerFailed'
  | 'rateLimited'
  | 'otpInvalid'
  | 'otpRejected'
  | 'paymentNotPending'

export class VoteError extends Error {
  constructor(public readonly problem: VoteProblem) {
    super(`Vote: ${problem}`)
    this.name = 'VoteError'
  }
}

type Doc<T> = T & Models.Document
const db = () => databaseId()

export function parseQuantity(input: unknown): number {
  const n = typeof input === 'string' ? Number(input.trim()) : input
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new VoteError('quantityInvalid')
  if (n < VOTE_QUANTITY_MIN || n > VOTE_QUANTITY_MAX_PLACEHOLDER) throw new VoteError('quantityInvalid')
  return n
}

export const INITIATIONS_PER_PHONE_PER_MINUTE = 6

export interface InitiateVoteInput {
  code: string
  quantity: unknown
  phone: string
  channel?: 'web' | 'ussd'
}

export interface InitiateVoteResult {
  payment: Doc<PaymentDoc>
  nominee: Doc<NomineeDoc>
  event: Doc<EventDoc>
  instructions?: string
  nextAction?: 'otp'
}

/**
 * Rule 1: the Payment exists as `pending` before the provider is asked to
 * debit anyone. Rule 4a: it records the round that is live right now.
 */
export interface VoteQuote {
  nominee: Doc<NomineeDoc>
  event: Doc<EventDoc>
  round: Doc<RoundDoc>
  organization: Doc<OrganizationDoc>
  categoryName: string
  /** Pesewas per vote. */
  votePrice: number
}

/**
 * Everything a voter needs to see before paying, and every check a vote
 * must pass before a payment may start: nominee active, organization active,
 * event live and inside its window, a live round, and the nominee in it.
 * Shared by the web vote page and the USSD menu so the two paths cannot
 * drift (PRD 5.3, "one tally").
 */
export async function quoteVote(code: string, now = new Date()): Promise<VoteQuote> {
  const nominee = await findNomineeByCode(code ?? '')
  if (!nominee) throw new VoteError('nomineeNotFound')
  if (nominee.status !== 'active') throw new VoteError('nomineeInactive')

  // Everything below is scoped by the nominee's organization, never by input.
  const ctx: TenantContext = { organizationId: nominee.organizationId, userId: 'public', role: 'scanner' }
  const organization = await getOrganization(nominee.organizationId)
  if (!organization || organization.status !== 'active') throw new VoteError('organizationInactive')

  const { databases } = createAdminClient()
  const event = await withRetry(() =>
    databases.getDocument<Doc<EventDoc>>(db(), APPWRITE.TABLES.EVENTS, nominee.eventId)
  )
  if (event.organizationId !== nominee.organizationId) throw new VoteError('nomineeNotFound')
  if (event.status !== 'live') throw new VoteError('eventNotLive')
  if (now < new Date(event.startsAt) || now > new Date(event.endsAt)) throw new VoteError('outsideWindow')

  const rounds = await listTenantDocuments<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, [
    Query.equal('eventId', [event.$id]),
    Query.equal('status', ['live']),
    Query.limit(1),
  ])
  const round = rounds.documents[0]
  if (!round) throw new VoteError('noLiveRound')

  const entries = await listTenantDocuments<RoundEntryDoc>(ctx, APPWRITE.TABLES.ROUND_ENTRIES, [
    Query.equal('roundId', [round.$id]),
    Query.equal('nomineeId', [nominee.$id]),
    Query.limit(1),
  ])
  if (!entries.documents[0]) throw new VoteError('notInRound')

  const categories = await listTenantDocuments<CategoryDoc>(ctx, APPWRITE.TABLES.CATEGORIES, [
    Query.equal('$id', [nominee.categoryId]),
    Query.limit(1),
  ])

  return {
    nominee,
    event,
    round,
    organization,
    categoryName: categories.documents[0]?.name ?? '',
    votePrice: event.votePrice,
  }
}

export async function initiateVotePayment(
  input: InitiateVoteInput,
  opts: { provider?: PaymentProvider; now?: Date } = {}
): Promise<InitiateVoteResult> {
  const now = opts.now ?? new Date()
  const quantity = parseQuantity(input.quantity)
  const payerPhone = normalizeGhanaPhone(input.phone ?? '')
  if (!payerPhone) throw new VoteError('phoneInvalid')

  // One budget per payer number across every channel (#27 placeholder): each
  // initiation sends a real MoMo prompt to that phone.
  if (!rateLimit(`initiate:phone:${payerPhone}`, INITIATIONS_PER_PHONE_PER_MINUTE, 60_000, now.getTime()).ok) {
    throw new VoteError('rateLimited')
  }

  const { nominee, event, round, organization } = await quoteVote(input.code, now)
  const { databases } = createAdminClient()

  let bps: number
  try {
    bps = effectiveCommissionBps(organization.commissionRate)
  } catch (err) {
    if (err instanceof FeesNotConfiguredError) throw new VoteError('feesNotConfigured')
    throw err
  }
  const amount = event.votePrice * quantity
  if (!Number.isSafeInteger(amount)) throw new VoteError('quantityInvalid')
  const { platformFee, organizerNet } = splitAmount(amount, bps)

  let provider: PaymentProvider
  try {
    provider = opts.provider ?? getPaymentProvider()
  } catch (err) {
    if (err instanceof PaymentProviderNotConfiguredError) throw new VoteError('providerNotConfigured')
    throw err
  }

  const paymentId = ID.unique()
  const payment = await withRetry(() =>
    databases.createDocument<Doc<PaymentDoc>>(db(), APPWRITE.TABLES.PAYMENTS, paymentId, {
      organizationId: nominee.organizationId,
      eventId: event.$id,
      roundId: round.$id,
      nomineeId: nominee.$id,
      tierId: null,
      payerName: null,
      channel: input.channel ?? 'web',
      purpose: 'vote',
      payerPhone,
      payerEmail: null,
      network: null,
      quantity,
      amount,
      platformFee,
      organizerNet,
      provider: provider.name,
      // Unique placeholder until the provider answers; replaced below.
      providerReference: `local_${paymentId}`,
      status: 'pending',
      confirmedAt: null,
      rawCallback: null,
    })
  )

  const started = await startProviderDebit(
    payment,
    provider,
    `${quantity} vote${quantity === 1 ? '' : 's'} for ${nominee.name} (${nominee.code})`
  )
  return {
    payment: started.payment,
    nominee,
    event,
    instructions: started.instructions,
    nextAction: started.nextAction,
  }
}

/**
 * Asks the provider to debit the payer for an existing `pending` Payment and
 * stores the provider's reference. Shared by votes and tickets.
 *
 * If the provider refuses, no debit started and the payment is marked
 * `failed`. If the provider accepted but the reference could not be stored,
 * the payment must stay `pending`: a callback can still match it by client
 * reference, and reconciliation re-checks it by payment id.
 */
export async function startProviderDebit(
  payment: Doc<PaymentDoc>,
  provider: PaymentProvider,
  description: string
): Promise<{ payment: Doc<PaymentDoc>; instructions?: string; nextAction?: 'otp' }> {
  const { databases } = createAdminClient()
  let initiated: Awaited<ReturnType<PaymentProvider['initiate']>>
  try {
    initiated = await provider.initiate({
      paymentId: payment.$id,
      amount: payment.amount,
      payerPhone: payment.payerPhone,
      description,
    })
  } catch (err) {
    await databases
      .updateDocument(db(), APPWRITE.TABLES.PAYMENTS, payment.$id, {
        status: 'failed',
        rawCallback: JSON.stringify({
          error: 'initiate_failed',
          message: err instanceof Error ? err.message : String(err),
        }),
      })
      .catch(() => {})
    throw new VoteError('providerFailed')
  }
  try {
    const updated = await withRetry(() =>
      databases.updateDocument<Doc<PaymentDoc>>(db(), APPWRITE.TABLES.PAYMENTS, payment.$id, {
        providerReference: initiated.providerReference,
      })
    )
    return { payment: updated, instructions: initiated.instructions, nextAction: initiated.nextAction }
  } catch (err) {
    console.error(`[payments] ${payment.$id}: provider reference ${initiated.providerReference} not stored`, err)
    return { payment, instructions: initiated.instructions, nextAction: initiated.nextAction }
  }
}

/** How long after initiation a one-time code is still accepted. */
export const OTP_WINDOW_MS = 15 * 60 * 1000

/**
 * The payer's one-time code for a charge that asked for one (`nextAction:
 * 'otp'`). It only continues the provider's charge: the payment stays
 * `pending` and is confirmed, as always, by the verified callback or
 * reconciliation (rule 2). A rejected code leaves it pending, and
 * reconciliation settles it.
 */
export async function submitPaymentOtp(
  paymentId: string,
  otpInput: unknown,
  opts: { provider?: PaymentProvider; now?: Date } = {}
): Promise<{ instructions?: string; nextAction?: 'otp' }> {
  const otp = typeof otpInput === 'string' ? otpInput.trim() : ''
  if (!/^\d{4,8}$/.test(otp)) throw new VoteError('otpInvalid')
  const payment = await getPayment(paymentId)
  const age = (opts.now ?? new Date()).getTime() - new Date(payment?.$createdAt ?? 0).getTime()
  if (!payment || payment.status !== 'pending' || age > OTP_WINDOW_MS) throw new VoteError('paymentNotPending')
  let provider: PaymentProvider
  try {
    provider = opts.provider ?? getPaymentProvider(payment.provider)
  } catch (err) {
    if (err instanceof PaymentProviderNotConfiguredError) throw new VoteError('providerNotConfigured')
    throw err
  }
  if (!provider.submitOtp) throw new VoteError('paymentNotPending')
  try {
    return await provider.submitOtp({ providerReference: payment.providerReference, otp })
  } catch (err) {
    console.warn(`[payments] ${payment.$id}: one-time code not accepted:`, err instanceof Error ? err.message : err)
    throw new VoteError('otpRejected')
  }
}

// ─── Confirmation ──────────────────────────────────────────────

export type ConfirmOutcome = 'confirmed' | 'duplicate' | 'failed' | 'unknown' | 'ignored' | 'mismatch'

export async function findPaymentByReference(providerReference: string): Promise<Doc<PaymentDoc> | null> {
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<Doc<PaymentDoc>>(db(), APPWRITE.TABLES.PAYMENTS, [
      Query.equal('providerReference', [providerReference]),
      Query.limit(1),
    ])
  )
  return res.documents[0] ?? null
}

export async function getPayment(paymentId: string): Promise<Doc<PaymentDoc> | null> {
  const { databases } = createAdminClient()
  try {
    return await withRetry(() => databases.getDocument<Doc<PaymentDoc>>(db(), APPWRITE.TABLES.PAYMENTS, paymentId))
  } catch (err) {
    if ((err as { code?: number })?.code === 404) return null
    throw err
  }
}

/** Deterministic ids: a replayed confirmation collides instead of double counting. */
export const paidVoteId = (paymentId: string) => `v_${paymentId}`
export const ledgerEntryId = (paymentId: string) => `l_${paymentId}`

class AlreadyConfirmed extends Error {}

function isConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: number }).code === 409
}

/**
 * Applies a verified provider result. Idempotent on `providerReference`
 * (rule 5): a repeat returns `duplicate` and writes nothing. Success is one
 * transaction (rule 4).
 *
 * PLACEHOLDER for OPEN_QUESTIONS #13: a success that arrives after the
 * payment's round closed is still credited to that round (the policy the docs
 * propose) and audited as `vote.late`. Flip it in `applyLatePaymentPolicy`.
 */
export async function confirmPayment(
  result: CallbackResult
): Promise<{ outcome: ConfirmOutcome; payment: Doc<PaymentDoc> | null }> {
  let payment = await findPaymentByReference(result.providerReference)
  if (!payment && result.clientReference) {
    // Match by our id when the provider's reference is unknown: either it was
    // never stored (initiate succeeded, the update did not) or the provider
    // reports a different id than it gave at initiation. Safe because every
    // result here was verified by the named adapter for that client
    // reference; the provider name must agree so a stray id cannot hijack a
    // payment that belongs to another adapter.
    const byId = await getPayment(result.clientReference)
    if (
      byId &&
      (byId.providerReference === `local_${byId.$id}` || (result.provider && byId.provider === result.provider))
    ) {
      payment = byId
    }
  }
  if (!payment) return { outcome: 'unknown', payment: null }
  if (payment.status === 'success') return { outcome: 'duplicate', payment }
  if (payment.status === 'refunded') return { outcome: 'ignored', payment }

  const { databases } = createAdminClient()
  const raw = JSON.stringify(result.raw ?? null).slice(0, 16000)

  if (result.status === 'failed') {
    if (payment.status !== 'pending') return { outcome: 'ignored', payment }
    const updated = await withRetry(() =>
      databases.updateDocument<Doc<PaymentDoc>>(db(), APPWRITE.TABLES.PAYMENTS, payment.$id, {
        status: 'failed',
        rawCallback: raw,
        network: result.network ?? payment.network,
      })
    )
    return { outcome: 'failed', payment: updated }
  }

  // Rule 6 and the fee split both assume the provider took exactly what we
  // asked for. A different amount is never credited; it is logged for a human.
  if (result.amountPesewas !== undefined && result.amountPesewas !== payment.amount) {
    const marker = 'amount_mismatch'
    const alreadyFlagged = typeof payment.rawCallback === 'string' && payment.rawCallback.includes(`"${marker}"`)
    if (!alreadyFlagged) {
      console.error(
        `[payments] ${payment.$id}: provider reports ${result.amountPesewas} pesewas, payment is ${payment.amount}`
      )
      // Keep the evidence on the row and audit once; later reconciliation runs see the marker.
      await withRetry(() =>
        databases.updateDocument(db(), APPWRITE.TABLES.PAYMENTS, payment.$id, {
          rawCallback: JSON.stringify({
            [marker]: { reported: result.amountPesewas, expected: payment.amount, at: new Date().toISOString() },
            raw: result.raw ?? null,
          }).slice(0, 16000),
        })
      )
      await writeAuditLog({
        actorId: 'system',
        organizationId: payment.organizationId,
        action: 'payment.amount_mismatch',
        target: `payments/${payment.$id}`,
        metadata: {
          reported: result.amountPesewas,
          expected: payment.amount,
          providerReference: result.providerReference,
        },
      })
    }
    return { outcome: 'mismatch', payment }
  }

  if (payment.purpose === 'ticket') return confirmTicketPayment(payment, result, raw)
  if (payment.purpose !== 'vote' || !payment.nomineeId || !payment.roundId) return { outcome: 'ignored', payment }

  const entries = await withRetry(() =>
    databases.listDocuments<Doc<RoundEntryDoc>>(db(), APPWRITE.TABLES.ROUND_ENTRIES, [
      Query.equal('roundId', [payment.roundId as string]),
      Query.equal('nomineeId', [payment.nomineeId as string]),
      Query.limit(1),
    ])
  )
  const entry = entries.documents[0]
  if (!entry)
    throw new Error(`Payment ${payment.$id}: nominee ${payment.nomineeId} has no entry in round ${payment.roundId}`)
  const round = await withRetry(() =>
    databases.getDocument<Doc<RoundDoc>>(db(), APPWRITE.TABLES.ROUNDS, payment.roundId as string)
  )
  applyLatePaymentPolicy(round)

  const now = new Date().toISOString()
  try {
    await runInTransaction(async (tx) => {
      const fresh = await databases.getDocument<Doc<PaymentDoc>>(db(), APPWRITE.TABLES.PAYMENTS, payment.$id, [], tx)
      if (fresh.status === 'success') throw new AlreadyConfirmed()

      await databases.updateDocument<Doc<PaymentDoc>>(
        db(),
        APPWRITE.TABLES.PAYMENTS,
        payment.$id,
        {
          status: 'success',
          confirmedAt: now,
          rawCallback: raw,
          network: result.network ?? payment.network,
          // Store the real reference if we only had the placeholder.
          ...(payment.providerReference.startsWith('local_') && result.providerReference !== payment.providerReference
            ? { providerReference: result.providerReference }
            : {}),
        },
        undefined,
        tx
      )
      await databases.createDocument<Doc<VoteDoc>>(
        db(),
        APPWRITE.TABLES.VOTES,
        paidVoteId(payment.$id),
        {
          organizationId: payment.organizationId,
          eventId: payment.eventId,
          roundId: payment.roundId as string,
          nomineeId: payment.nomineeId as string,
          paymentId: payment.$id,
          quantity: payment.quantity,
          source: 'paid',
          grantedBy: null,
          reason: null,
        },
        undefined,
        tx
      )
      await databases.incrementDocumentAttribute(
        db(),
        APPWRITE.TABLES.ROUND_ENTRIES,
        entry.$id,
        'voteCount',
        payment.quantity,
        undefined,
        tx
      )
      await databases.createDocument<Doc<LedgerEntryDoc>>(
        db(),
        APPWRITE.TABLES.LEDGER_ENTRIES,
        ledgerEntryId(payment.$id),
        {
          organizationId: payment.organizationId,
          type: 'vote_credit',
          amount: payment.organizerNet,
          paymentId: payment.$id,
          note: null,
        },
        undefined,
        tx
      )
      if (round.status === 'closed') {
        // #13 placeholder: the late credit and its audit row commit together,
        // so there is never a late vote without a trail.
        await databases.createDocument(
          db(),
          APPWRITE.TABLES.AUDIT_LOGS,
          ID.unique(),
          {
            actorId: 'system',
            organizationId: payment.organizationId,
            action: 'vote.late',
            target: `payments/${payment.$id}`,
            metadata: JSON.stringify({ roundId: round.$id, closedAt: round.closedAt, quantity: payment.quantity }),
          },
          undefined,
          tx
        )
      }
    })
  } catch (err) {
    if (err instanceof AlreadyConfirmed)
      return { outcome: 'duplicate', payment: (await getPayment(payment.$id)) ?? payment }
    // A failed commit is either a concurrent confirmation of the same payment
    // (the row is `success` now) or a real fault. Decide by re-reading, not by
    // error code: Appwrite's commit error shape is not pinned down here.
    const current = await getPayment(payment.$id)
    if (current?.status === 'success') return { outcome: 'duplicate', payment: current }
    if (isConflict(err)) return { outcome: 'duplicate', payment: current ?? payment }
    throw err
  }

  return { outcome: 'confirmed', payment: (await getPayment(payment.$id)) ?? payment }
}

/**
 * Ticket confirmation (PRD 5.4b): in one transaction the Payment becomes
 * `success`, one Ticket row per ticket is created with a deterministic id
 * and a signed QR token, the tier's sold counter grows, and the ledger is
 * credited. Replays collide on the ticket ids. Email goes out after commit;
 * the buyer always has the ticket links on the confirmation page as well.
 */
async function confirmTicketPayment(
  payment: Doc<PaymentDoc>,
  result: CallbackResult,
  raw: string
): Promise<{ outcome: ConfirmOutcome; payment: Doc<PaymentDoc> | null }> {
  const { databases } = createAdminClient()
  if (!payment.tierId) return { outcome: 'ignored', payment }
  const tier = await withRetry(() =>
    databases.getDocument<Doc<TicketTierDoc>>(db(), APPWRITE.TABLES.TICKET_TIERS, payment.tierId as string)
  )
  const now = new Date().toISOString()
  const { signTicketToken, ticketId } = await import('./tickets/token')
  try {
    await runInTransaction(async (tx) => {
      const fresh = await databases.getDocument<Doc<PaymentDoc>>(db(), APPWRITE.TABLES.PAYMENTS, payment.$id, [], tx)
      if (fresh.status === 'success') throw new AlreadyConfirmed()
      await databases.updateDocument<Doc<PaymentDoc>>(
        db(),
        APPWRITE.TABLES.PAYMENTS,
        payment.$id,
        {
          status: 'success',
          confirmedAt: now,
          rawCallback: raw,
          network: result.network ?? payment.network,
          ...(payment.providerReference.startsWith('local_') && result.providerReference !== payment.providerReference
            ? { providerReference: result.providerReference }
            : {}),
        },
        undefined,
        tx
      )
      for (let i = 0; i < payment.quantity; i++) {
        const id = ticketId(payment.$id, i)
        await databases.createDocument<Doc<TicketDoc>>(
          db(),
          APPWRITE.TABLES.TICKETS,
          id,
          {
            organizationId: payment.organizationId,
            eventId: payment.eventId,
            tierId: tier.$id,
            paymentId: payment.$id,
            buyerName: payment.payerName,
            buyerPhone: payment.payerPhone,
            buyerEmail: payment.payerEmail,
            qrToken: signTicketToken(id),
            status: 'valid',
            usedAt: null,
            scannedBy: null,
            emailSentAt: null,
          },
          undefined,
          tx
        )
      }
      await databases.incrementDocumentAttribute(
        db(),
        APPWRITE.TABLES.TICKET_TIERS,
        tier.$id,
        'quantitySold',
        payment.quantity,
        undefined,
        tx
      )
      await databases.createDocument<Doc<LedgerEntryDoc>>(
        db(),
        APPWRITE.TABLES.LEDGER_ENTRIES,
        ledgerEntryId(payment.$id),
        {
          organizationId: payment.organizationId,
          type: 'ticket_credit',
          amount: payment.organizerNet,
          paymentId: payment.$id,
          note: null,
        },
        undefined,
        tx
      )
    })
  } catch (err) {
    if (err instanceof AlreadyConfirmed)
      return { outcome: 'duplicate', payment: (await getPayment(payment.$id)) ?? payment }
    const current = await getPayment(payment.$id)
    if (current?.status === 'success') return { outcome: 'duplicate', payment: current }
    if (isConflict(err)) return { outcome: 'duplicate', payment: current ?? payment }
    throw err
  }

  // Oversold past the cap by in-flight payments: the money moved, so the tickets stand; a human is told.
  const after = await withRetry(() =>
    databases.getDocument<Doc<TicketTierDoc>>(db(), APPWRITE.TABLES.TICKET_TIERS, tier.$id)
  )
  if (after.quantityAvailable !== null && after.quantitySold > after.quantityAvailable) {
    await writeAuditLog({
      actorId: 'system',
      organizationId: payment.organizationId,
      action: 'ticket.oversold',
      target: `ticket_tiers/${tier.$id}`,
      metadata: { sold: after.quantitySold, available: after.quantityAvailable, paymentId: payment.$id },
    })
  }

  await sendTicketEmail(payment, tier).catch((err) => console.error('[tickets] email failed', err))
  return { outcome: 'confirmed', payment: (await getPayment(payment.$id)) ?? payment }
}

async function sendTicketEmail(payment: Doc<PaymentDoc>, tier: Doc<TicketTierDoc>): Promise<void> {
  if (!payment.payerEmail) return
  const { databases } = createAdminClient()
  const [event, organization, tickets] = await Promise.all([
    withRetry(() => databases.getDocument<Doc<EventDoc>>(db(), APPWRITE.TABLES.EVENTS, payment.eventId)),
    getOrganization(payment.organizationId),
    withRetry(() =>
      databases.listDocuments<Doc<TicketDoc>>(db(), APPWRITE.TABLES.TICKETS, [
        Query.equal('paymentId', [payment.$id]),
        Query.limit(100),
      ])
    ),
  ])
  const { getEmailProvider } = await import('./email')
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const sent = await getEmailProvider().sendTickets({
    to: payment.payerEmail,
    buyerName: payment.payerName,
    eventTitle: event.title,
    organizationName: organization?.name ?? '',
    tierName: tier.name,
    ticketUrls: tickets.documents.map((t) => `${base}/t/${t.qrToken}`),
  })
  if (sent.sent) {
    const at = new Date().toISOString()
    await Promise.all(
      tickets.documents.map((t) => databases.updateDocument(db(), APPWRITE.TABLES.TICKETS, t.$id, { emailSentAt: at }))
    )
  }
}

/** PLACEHOLDER (#13). Honour: do nothing. Refund: throw here and handle upstream. */
export function applyLatePaymentPolicy(_round: Pick<RoundDoc, 'status'>): void {
  // Honour late payments against the round recorded at initiation.
}

// ─── Reconciliation (rule 5) ───────────────────────────────────

export async function reconcilePendingPayments(
  opts: { provider?: PaymentProvider; olderThanMs?: number; now?: Date; limit?: number } = {}
): Promise<{ checked: number; confirmed: number; failed: number; skipped: number; errors: number }> {
  const provider = opts.provider ?? getPaymentProvider()
  const cutoff = new Date((opts.now ?? new Date()).getTime() - (opts.olderThanMs ?? 10 * 60 * 1000)).toISOString()
  const { databases } = createAdminClient()
  const stale = await withRetry(() =>
    databases.listDocuments<Doc<PaymentDoc>>(db(), APPWRITE.TABLES.PAYMENTS, [
      Query.equal('status', ['pending']),
      // Only this provider's payments: another provider's ids mean nothing to its status API.
      Query.equal('provider', [provider.name]),
      Query.lessThan('$createdAt', cutoff),
      Query.limit(opts.limit ?? 100),
    ])
  )
  const totals = { checked: 0, confirmed: 0, failed: 0, skipped: 0, errors: 0 }
  for (const payment of stale.documents) {
    totals.checked += 1
    try {
      // One status call per payment: adapters that can return the verified
      // record do so directly; the rest answer with a bare verdict.
      let result: CallbackResult | null = null
      if (provider.verifiedResult) {
        result = await provider.verifiedResult(payment.$id)
      } else {
        const status = await provider.checkStatus({
          providerReference: payment.providerReference,
          clientReference: payment.$id,
        })
        if (status === 'success' || status === 'failed') {
          result = {
            provider: provider.name,
            providerReference: payment.providerReference,
            clientReference: payment.$id,
            status,
            raw: { source: 'reconcile', status, checkedAt: new Date().toISOString() },
          }
        }
      }
      if (!result) {
        totals.skipped += 1
        continue
      }
      const { outcome } = await confirmPayment(result)
      if (outcome === 'confirmed') totals.confirmed += 1
      else if (outcome === 'failed') totals.failed += 1
      else totals.skipped += 1
    } catch (err) {
      // A provider fault on one payment must not stop the rest; it stays pending for the next run.
      console.error(`[payments.reconcile] ${payment.$id}:`, err)
      totals.errors += 1
    }
  }
  return totals
}

// ─── Tallies (PRD 5.4) ─────────────────────────────────────────

export interface RoundTallyRow {
  nominee: Doc<NomineeDoc>
  entry: Doc<RoundEntryDoc>
  /** Free votes within `entry.voteCount`, from the Vote rows. */
  free: number
}

/** Free votes per nominee in a round, from the Vote rows (never the cached tally). */
export async function freeVotesByNominee(ctx: TenantContext, roundId: string): Promise<Map<string, number>> {
  const res = await listTenantDocuments<VoteDoc>(ctx, APPWRITE.TABLES.VOTES, [
    Query.equal('roundId', [roundId]),
    Query.equal('source', ['free']),
    Query.limit(5000),
  ])
  const out = new Map<string, number>()
  for (const v of res.documents) out.set(v.nomineeId, (out.get(v.nomineeId) ?? 0) + v.quantity)
  return out
}

export async function tallyForRound(ctx: TenantContext, roundId: string): Promise<RoundTallyRow[]> {
  const [entries, nominees, free] = await Promise.all([
    listTenantDocuments<RoundEntryDoc>(ctx, APPWRITE.TABLES.ROUND_ENTRIES, [
      Query.equal('roundId', [roundId]),
      Query.limit(500),
    ]),
    listTenantDocuments<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, [Query.limit(500)]),
    freeVotesByNominee(ctx, roundId),
  ])
  const byId = new Map(nominees.documents.map((n) => [n.$id, n]))
  return entries.documents
    .flatMap((entry) => {
      const nominee = byId.get(entry.nomineeId)
      return nominee ? [{ nominee, entry, free: free.get(entry.nomineeId) ?? 0 }] : []
    })
    .sort((a, b) => b.entry.voteCount - a.entry.voteCount || a.nominee.name.localeCompare(b.nominee.name))
}

export interface EventFigures {
  paidVotes: number
  freeVotes: number
  totalVotes: number
  gross: number
  platformShare: number
  organizerShare: number
  successfulPayments: number
}

/** Dashboard figures (PRD 5.4): from successful payments and free votes, never from the cached tally. */
export async function eventFigures(ctx: TenantContext, eventId: string): Promise<EventFigures> {
  const [payments, free] = await Promise.all([
    listTenantDocuments<PaymentDoc>(ctx, APPWRITE.TABLES.PAYMENTS, [
      Query.equal('eventId', [eventId]),
      Query.equal('status', ['success']),
      Query.equal('purpose', ['vote']),
      Query.limit(5000),
    ]),
    listTenantDocuments<VoteDoc>(ctx, APPWRITE.TABLES.VOTES, [
      Query.equal('eventId', [eventId]),
      Query.equal('source', ['free']),
      Query.limit(5000),
    ]),
  ])
  const figures: EventFigures = {
    paidVotes: 0,
    freeVotes: 0,
    totalVotes: 0,
    gross: 0,
    platformShare: 0,
    organizerShare: 0,
    successfulPayments: 0,
  }
  for (const p of payments.documents) {
    figures.paidVotes += p.quantity
    figures.gross += p.amount
    figures.platformShare += p.platformFee
    figures.organizerShare += p.organizerNet
    figures.successfulPayments += 1
  }
  for (const v of free.documents) figures.freeVotes += v.quantity
  figures.totalVotes = figures.paidVotes + figures.freeVotes
  return figures
}

/** Recomputes a cached tally from the Vote rows. For reconciliation and tests. */
export async function recountRoundEntry(ctx: TenantContext, entryId: string): Promise<number> {
  const { databases } = createAdminClient()
  const entry = await withRetry(() =>
    databases.getDocument<Doc<RoundEntryDoc>>(db(), APPWRITE.TABLES.ROUND_ENTRIES, entryId)
  )
  if (entry.organizationId !== ctx.organizationId) throw new Error('Entry belongs to another organization')
  const votes = await listTenantDocuments<VoteDoc>(ctx, APPWRITE.TABLES.VOTES, [
    Query.equal('roundId', [entry.roundId]),
    Query.equal('nomineeId', [entry.nomineeId]),
    Query.limit(5000),
  ])
  const total = votes.documents.reduce((sum, v) => sum + v.quantity, 0)
  if (total !== entry.voteCount) {
    await withRetry(() => databases.updateDocument(db(), APPWRITE.TABLES.ROUND_ENTRIES, entryId, { voteCount: total }))
  }
  return total
}
