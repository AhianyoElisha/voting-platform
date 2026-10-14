import { Query } from 'node-appwrite'
import { APPWRITE } from './constants'
import { listTenantDocuments, type TenantContext } from './db'
import type { LedgerEntryDoc, PayoutDoc } from './types'

/**
 * The organizer's wallet (DATA_MODEL.md "Money out"). Nothing is stored as a
 * balance: credits come from confirmed vote and ticket payments, debits from
 * paid payouts, and payouts still in flight reserve their amount. All
 * integers in pesewas.
 */
export interface Balance {
  credits: number
  debits: number
  /** Payouts requested or approved but not yet paid. */
  reserved: number
  /** credits + debits (debits are negative) - reserved. */
  available: number
}

export const RESERVING_STATUSES: PayoutDoc['status'][] = ['requested', 'approved']

export function computeBalance(
  entries: Pick<LedgerEntryDoc, 'amount'>[],
  reserving: Pick<PayoutDoc, 'amount'>[]
): Balance {
  let credits = 0
  let debits = 0
  for (const e of entries) {
    if (e.amount >= 0) credits += e.amount
    else debits += e.amount
  }
  const reserved = reserving.reduce((sum, p) => sum + p.amount, 0)
  return { credits, debits, reserved, available: credits + debits - reserved }
}

export async function listLedger(ctx: TenantContext): Promise<LedgerEntryDoc[]> {
  const res = await listTenantDocuments<LedgerEntryDoc>(ctx, APPWRITE.TABLES.LEDGER_ENTRIES, [
    Query.orderDesc('$createdAt'),
    Query.limit(5000),
  ])
  return res.documents
}

export async function balanceFor(ctx: TenantContext): Promise<Balance> {
  const [entries, payouts] = await Promise.all([
    listTenantDocuments<LedgerEntryDoc>(ctx, APPWRITE.TABLES.LEDGER_ENTRIES, [Query.limit(5000)]),
    listTenantDocuments<PayoutDoc>(ctx, APPWRITE.TABLES.PAYOUTS, [
      Query.equal('status', RESERVING_STATUSES),
      Query.limit(500),
    ]),
  ])
  return computeBalance(entries.documents, payouts.documents)
}
