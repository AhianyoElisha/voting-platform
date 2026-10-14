import crypto from 'crypto'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { writeAuditLog } from './audit'
import { APPWRITE, payoutMinimumPesewas } from './constants'
import { databaseId, getTenantDocument, listTenantDocuments, runInTransaction, type TenantContext } from './db'
import { balanceFor } from './ledger-server'
import { InvalidAmountError, cedisToPesewas, isPesewas } from './money'
import { normalizeGhanaPhone } from './phone'
import { assertCanManage } from './tenant'
import type { LedgerEntryDoc, PayoutDestination, PayoutDoc, PayoutStatus } from './types'

/**
 * Payouts (PRD 5.6, OPEN_QUESTIONS #3 placeholder: manual approval). The
 * organizer requests; the super admin approves or rejects, transfers the
 * money outside the platform, and marks the payout paid. Money leaves the
 * ledger only at `paid`, in one transaction with the debit row, and only if
 * the balance still covers it. A request reserves its amount so two
 * requests cannot both spend the same credit.
 */
export type PayoutProblem =
  'amountInvalid' | 'belowMinimum' | 'insufficient' | 'destinationInvalid' | 'badTransition' | 'keyInvalid' | 'busy'

export class PayoutError extends Error {
  constructor(public readonly problem: PayoutProblem) {
    super(`Payout: ${problem}`)
    this.name = 'PayoutError'
  }
}

type Doc<T> = T & Models.Document
const db = () => databaseId()

export function parseDestination(input: unknown): PayoutDestination {
  const d = (input ?? {}) as Record<string, unknown>
  const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
  if (d.kind === 'momo') {
    const phone = normalizeGhanaPhone(str(d.phone, 32))
    const name = str(d.name)
    if (!phone || name.length < 2) throw new PayoutError('destinationInvalid')
    return { kind: 'momo', phone, name }
  }
  if (d.kind === 'bank') {
    const bankName = str(d.bankName)
    const accountNumber = str(d.accountNumber, 40).replace(/\s/g, '')
    const accountName = str(d.accountName)
    if (bankName.length < 2 || !/^[A-Za-z0-9-]{6,40}$/.test(accountNumber) || accountName.length < 2)
      throw new PayoutError('destinationInvalid')
    return { kind: 'bank', bankName, accountNumber, accountName }
  }
  throw new PayoutError('destinationInvalid')
}

export function payoutId(organizationId: string, idempotencyKey: string): string {
  return `po_${crypto.createHash('sha256').update(`${organizationId}:${idempotencyKey}`).digest('base64url').slice(0, 28)}`
}

export interface RequestPayoutInput {
  amountCedis?: string
  amount?: number
  destination: unknown
  idempotencyKey: string
}

class Insufficient extends Error {}

export async function requestPayout(
  ctx: TenantContext,
  input: RequestPayoutInput
): Promise<{ outcome: 'requested' | 'duplicate'; payout: Doc<PayoutDoc> }> {
  assertCanManage(ctx)
  let amount: number
  if (input.amount !== undefined) {
    if (!isPesewas(input.amount)) throw new PayoutError('amountInvalid')
    amount = input.amount
  } else {
    try {
      amount = cedisToPesewas(input.amountCedis ?? '')
    } catch (err) {
      if (err instanceof InvalidAmountError) throw new PayoutError('amountInvalid')
      throw err
    }
  }
  if (amount <= 0) throw new PayoutError('amountInvalid')
  const min = payoutMinimumPesewas()
  if (min > 0 && amount < min) throw new PayoutError('belowMinimum')
  const destination = parseDestination(input.destination)
  const key = (input.idempotencyKey ?? '').trim()
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw new PayoutError('keyInvalid')

  const id = payoutId(ctx.organizationId, key)
  const { databases } = createAdminClient()
  const existing = await databases.getDocument<Doc<PayoutDoc>>(db(), APPWRITE.TABLES.PAYOUTS, id).catch(() => null)
  if (existing) return { outcome: 'duplicate', payout: existing }
  try {
    await runInTransaction(async (tx) => {
      // A request reserves against the balance it can see. Two requests in the
      // same instant can both pass this check; that only over-reserves. Money
      // leaves only in markPayoutPaid, which re-checks against settled credits.
      const balance = await balanceFor(ctx)
      if (amount > balance.available) throw new Insufficient()
      await databases.createDocument<Doc<PayoutDoc>>(
        db(),
        APPWRITE.TABLES.PAYOUTS,
        id,
        {
          organizationId: ctx.organizationId,
          amount,
          destinationKind: destination.kind,
          destination: JSON.stringify(destination),
          status: 'requested',
          requestedBy: ctx.userId,
          decidedBy: null,
          note: null,
          decidedAt: null,
          paidAt: null,
        },
        undefined,
        tx
      )
    })
  } catch (err) {
    if (err instanceof Insufficient) throw new PayoutError('insufficient')
    const raced = await databases.getDocument<Doc<PayoutDoc>>(db(), APPWRITE.TABLES.PAYOUTS, id).catch(() => null)
    if (raced) return { outcome: 'duplicate', payout: raced }
    throw err
  }
  const payout = await withRetry(() => databases.getDocument<Doc<PayoutDoc>>(db(), APPWRITE.TABLES.PAYOUTS, id))
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'payout.request',
    target: `payouts/${id}`,
    metadata: { amount, kind: destination.kind },
  })
  return { outcome: 'requested', payout }
}

async function getPayout(id: string): Promise<Doc<PayoutDoc>> {
  const { databases } = createAdminClient()
  return withRetry(() => databases.getDocument<Doc<PayoutDoc>>(db(), APPWRITE.TABLES.PAYOUTS, id))
}

export async function listPayouts(ctx: TenantContext): Promise<Doc<PayoutDoc>[]> {
  const res = await listTenantDocuments<PayoutDoc>(ctx, APPWRITE.TABLES.PAYOUTS, [
    Query.orderDesc('$createdAt'),
    Query.limit(200),
  ])
  return res.documents
}

/**
 * A status change that holds only if the row is still in `from` when the
 * transaction reads it, so a cancel and an approval racing each other cannot
 * both win.
 */
async function transition(
  databases: ReturnType<typeof createAdminClient>['databases'],
  id: string,
  from: PayoutStatus,
  data: Partial<PayoutDoc>
): Promise<void> {
  await runInTransaction(async (tx) => {
    const fresh = await databases.getDocument<Doc<PayoutDoc>>(db(), APPWRITE.TABLES.PAYOUTS, id, [], tx)
    if (fresh.status !== from) throw new PayoutError('badTransition')
    await databases.updateDocument<Doc<PayoutDoc>>(db(), APPWRITE.TABLES.PAYOUTS, id, data, undefined, tx)
  })
}

/** The organizer withdraws a request that nobody has acted on. */
export async function cancelPayout(ctx: TenantContext, id: string): Promise<Doc<PayoutDoc>> {
  assertCanManage(ctx)
  const payout = await getTenantDocument<PayoutDoc>(ctx, APPWRITE.TABLES.PAYOUTS, id)
  if (payout.status !== 'requested') throw new PayoutError('badTransition')
  const { databases } = createAdminClient()
  await transition(databases, id, 'requested', {
    status: 'rejected',
    decidedBy: ctx.userId,
    decidedAt: new Date().toISOString(),
    note: 'Cancelled by organizer',
  })
  const updated = await getPayout(id)
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'payout.cancel',
    target: `payouts/${id}`,
  })
  return updated
}

// ─── Per-organization mutex for the paid step ──────────────────

export const PAYOUT_LOCK_TTL_MS = 30_000

/**
 * Serializes money leaving one organization. A transaction is not a lock:
 * two payouts marked paid in the same instant would each see the balance
 * before the other's debit. The lock row's id is the organization id, so a
 * second holder collides on creation. An expired lock (a crashed holder) is
 * reclaimed once.
 */
export async function withPayoutLock<T>(
  organizationId: string,
  holder: string,
  fn: () => Promise<T>,
  now = new Date()
): Promise<T> {
  const { databases } = createAdminClient()
  const acquire = async (): Promise<boolean> => {
    try {
      await databases.createDocument(db(), APPWRITE.TABLES.PAYOUT_LOCKS, organizationId, {
        organizationId,
        holder,
        expiresAt: new Date(now.getTime() + PAYOUT_LOCK_TTL_MS).toISOString(),
      })
      return true
    } catch (err) {
      if ((err as { code?: number })?.code !== 409) throw err
      return false
    }
  }
  if (!(await acquire())) {
    const held = await databases
      .getDocument<{ expiresAt: string } & Models.Document>(db(), APPWRITE.TABLES.PAYOUT_LOCKS, organizationId)
      .catch(() => null)
    if (held && new Date(held.expiresAt) < now) {
      await databases.deleteDocument(db(), APPWRITE.TABLES.PAYOUT_LOCKS, organizationId).catch(() => {})
      if (!(await acquire())) throw new PayoutError('busy')
    } else {
      throw new PayoutError('busy')
    }
  }
  try {
    return await fn()
  } finally {
    await databases.deleteDocument(db(), APPWRITE.TABLES.PAYOUT_LOCKS, organizationId).catch(() => {})
  }
}

// ─── Super admin side (platform level, not tenant-scoped by membership) ──

export async function listAllPayouts(statuses: PayoutStatus[] = ['requested', 'approved']): Promise<Doc<PayoutDoc>[]> {
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<Doc<PayoutDoc>>(db(), APPWRITE.TABLES.PAYOUTS, [
      Query.equal('status', statuses),
      Query.orderAsc('$createdAt'),
      Query.limit(500),
    ])
  )
  return res.documents
}

export async function decidePayout(
  adminUserId: string,
  id: string,
  decision: 'approved' | 'rejected',
  note?: string
): Promise<Doc<PayoutDoc>> {
  const payout = await getPayout(id)
  if (payout.status !== 'requested') throw new PayoutError('badTransition')
  const { databases } = createAdminClient()
  await transition(databases, id, 'requested', {
    status: decision,
    decidedBy: adminUserId,
    decidedAt: new Date().toISOString(),
    note: (note ?? '').trim().slice(0, 500) || null,
  })
  const updated = await getPayout(id)
  await writeAuditLog({
    actorId: adminUserId,
    organizationId: payout.organizationId,
    action: `payout.${decision}`,
    target: `payouts/${id}`,
    metadata: { amount: payout.amount },
  })
  return updated
}

export const payoutDebitId = (id: string) => `l_po_${id.slice(3)}`

/**
 * The money has been transferred outside the platform. In one transaction:
 * the payout becomes `paid` and the ledger gets the debit. The debit's id
 * derives from the payout, so marking twice debits once. The balance is
 * re-checked here: this is the only place money actually leaves.
 */
export async function markPayoutPaid(
  adminUserId: string,
  id: string,
  note?: string
): Promise<{ outcome: 'paid' | 'duplicate'; payout: Doc<PayoutDoc> }> {
  const payout = await getPayout(id)
  if (payout.status === 'paid') return { outcome: 'duplicate', payout }
  if (payout.status !== 'approved') throw new PayoutError('badTransition')
  const ctx: TenantContext = { organizationId: payout.organizationId, userId: adminUserId, role: 'owner' }
  const { databases } = createAdminClient()
  const now = new Date().toISOString()
  try {
    await withPayoutLock(payout.organizationId, adminUserId, () =>
      runInTransaction(async (tx) => {
        const fresh = await databases.getDocument<Doc<PayoutDoc>>(db(), APPWRITE.TABLES.PAYOUTS, id, [], tx)
        if (fresh.status !== 'approved') throw new PayoutError('badTransition')
        // Money out may never exceed money in: settled credits plus debits must cover
        // this payout. Other organizations' requests and this one's own reservation
        // are irrelevant here; only what has actually been paid out counts.
        const balance = await balanceFor(ctx)
        if (balance.credits + balance.debits < payout.amount) throw new Insufficient()
        await databases.createDocument<Doc<LedgerEntryDoc>>(
          db(),
          APPWRITE.TABLES.LEDGER_ENTRIES,
          payoutDebitId(id),
          {
            organizationId: payout.organizationId,
            type: 'payout_debit',
            amount: -payout.amount,
            paymentId: `payout:${id}`,
            note: (note ?? '').trim().slice(0, 500) || null,
          },
          undefined,
          tx
        )
        await databases.updateDocument<Doc<PayoutDoc>>(
          db(),
          APPWRITE.TABLES.PAYOUTS,
          id,
          { status: 'paid', paidAt: now },
          undefined,
          tx
        )
      })
    )
  } catch (err) {
    if (err instanceof Insufficient) throw new PayoutError('insufficient')
    if (err instanceof PayoutError && err.problem === 'busy') throw err
    const current = await getPayout(id)
    if (current.status === 'paid') return { outcome: 'duplicate', payout: current }
    throw err
  }
  const paid = await getPayout(id)
  await writeAuditLog({
    actorId: adminUserId,
    organizationId: payout.organizationId,
    action: 'payout.paid',
    target: `payouts/${id}`,
    metadata: { amount: payout.amount },
  })
  return { outcome: 'paid', payout: paid }
}
