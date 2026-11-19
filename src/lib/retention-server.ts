import { ID, Query } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { APPWRITE } from './constants'
import { databaseId, type Doc } from './db'
import { ERASED_PHONE } from './phone'
import type { EventDoc, PaymentDoc, TicketDoc } from './types'

/**
 * Data retention (decision #28, 2026-11-13; DATA_MODEL "Integrity
 * constraints"): 90 days after an event closes, the names, phone numbers and
 * email addresses on its payments and tickets are erased, along with personal
 * details inside `rawCallback`. Amounts, votes, ticket status and provider
 * references stay, because the accounts and payouts depend on them.
 *
 * Run daily by `/api/internal/retention/erase`. Each run is bounded and
 * idempotent: rows already erased are skipped, and an event is marked
 * `personalDataErasedAt` only once every row of it is done, so a run that
 * stops halfway is finished by the next one.
 */

export const RETENTION_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

/** What an erased required phone column holds; `maskPhone` shows it as blank. */
export const ERASED = ERASED_PHONE

/** USSD sessions last minutes; their rows (with the caller's number) go after a day. */
const USSD_SESSION_KEEP_MS = DAY_MS

/** Bounds per run, so the job stays inside a serverless time limit; the rest waits for the next run. */
const MAX_EVENTS_PER_RUN = 20
const PAGE = 100

/**
 * The only `rawCallback` fields kept after erasure, at any depth: what a
 * dispute about money could still need, never who paid. Everything else
 * (customer, authorization, phone numbers, emails, names, metadata, free-text
 * messages that may echo a number) is dropped.
 */
const RAW_KEEP = new Set([
  // Paystack
  'event',
  'status',
  'reference',
  'amount',
  'fees',
  'currency',
  'channel',
  'paid_at',
  'paidAt',
  'created_at',
  'createdAt',
  'id',
  // Hubtel
  'ResponseCode',
  'Status',
  'Amount',
  'Charges',
  'AmountAfterCharges',
  'TransactionId',
  'ClientReference',
  'ExternalTransactionId',
  // Ours: reconciliation records, the mismatch evidence and initiation failures
  'source',
  'checkedAt',
  'providerReference',
  'clientReference',
  'error',
  'reported',
  'expected',
  'at',
])

const REDACTED_KEY = '_redacted'

function keepAllowed(value: unknown): unknown {
  if (Array.isArray(value)) {
    const kept = value.map(keepAllowed).filter((v) => v !== undefined)
    return kept.length ? kept : undefined
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      if (v && typeof v === 'object') {
        const kept = keepAllowed(v)
        if (kept !== undefined) out[key] = kept
      } else if (RAW_KEEP.has(key)) {
        out[key] = v
      }
    }
    return Object.keys(out).length ? out : undefined
  }
  return undefined
}

/** `rawCallback` with only the allowlisted fields left, marked as redacted. Null stays null. */
export function redactRawCallback(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Not JSON: nothing can be shown to be safe, so nothing is kept.
    return JSON.stringify({ [REDACTED_KEY]: true })
  }
  const kept = keepAllowed(parsed)
  const base = kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {}
  return JSON.stringify({ [REDACTED_KEY]: true, ...base })
}

function isRedacted(raw: string | null | undefined): boolean {
  return raw === null || raw === undefined || raw === '' || raw.startsWith(`{"${REDACTED_KEY}":true`)
}

/**
 * When the event closed. `closedAt` is recorded on closing from 2026-11-19;
 * older events fall back to the later of their end time and last update,
 * which is never earlier than the real close, so nothing is erased early.
 */
export function eventClosedAt(event: Pick<Doc<EventDoc>, 'closedAt' | 'endsAt' | '$updatedAt'>): Date {
  if (event.closedAt) return new Date(event.closedAt)
  return new Date(Math.max(Date.parse(event.endsAt), Date.parse(event.$updatedAt)))
}

export function isDueForErasure(
  event: Pick<Doc<EventDoc>, 'status' | 'closedAt' | 'endsAt' | '$updatedAt' | 'personalDataErasedAt'>,
  now: Date
): boolean {
  if (event.status !== 'closed' || event.personalDataErasedAt) return false
  return now.getTime() - eventClosedAt(event).getTime() >= RETENTION_DAYS * DAY_MS
}

export interface ErasureTotals {
  events: number
  payments: number
  tickets: number
  ussdSessions: number
}

async function eachPage<T>(table: string, queries: string[], visit: (docs: Doc<T>[]) => Promise<void>): Promise<void> {
  const { databases } = createAdminClient()
  let cursor: string | null = null
  for (;;) {
    const page = await withRetry(() =>
      databases.listDocuments<Doc<T>>(databaseId(), table, [
        ...queries,
        Query.orderAsc('$id'),
        Query.limit(PAGE),
        ...(cursor ? [Query.cursorAfter(cursor)] : []),
      ])
    )
    await visit(page.documents)
    if (page.documents.length < PAGE) return
    cursor = page.documents[page.documents.length - 1].$id
  }
}

async function eraseEvent(event: Doc<EventDoc>, now: Date): Promise<{ payments: number; tickets: number }> {
  const { databases } = createAdminClient()
  const scope = [Query.equal('organizationId', [event.organizationId]), Query.equal('eventId', [event.$id])]
  let payments = 0
  let tickets = 0

  await eachPage<PaymentDoc>(APPWRITE.TABLES.PAYMENTS, scope, async (docs) => {
    for (const p of docs) {
      if (p.payerPhone === ERASED && !p.payerEmail && !p.payerName && isRedacted(p.rawCallback)) continue
      await withRetry(() =>
        databases.updateDocument(databaseId(), APPWRITE.TABLES.PAYMENTS, p.$id, {
          payerPhone: ERASED,
          payerEmail: null,
          payerName: null,
          rawCallback: redactRawCallback(p.rawCallback),
        })
      )
      payments += 1
    }
  })

  await eachPage<TicketDoc>(APPWRITE.TABLES.TICKETS, scope, async (docs) => {
    for (const t of docs) {
      if (t.buyerPhone === ERASED && !t.buyerEmail && !t.buyerName) continue
      await withRetry(() =>
        databases.updateDocument(databaseId(), APPWRITE.TABLES.TICKETS, t.$id, {
          buyerPhone: ERASED,
          buyerEmail: null,
          buyerName: null,
        })
      )
      tickets += 1
    }
  })

  // Marked last: if anything above failed, the next run picks the event up again.
  const at = now.toISOString()
  await withRetry(() =>
    databases.updateDocument(databaseId(), APPWRITE.TABLES.EVENTS, event.$id, { personalDataErasedAt: at })
  )
  await withRetry(() =>
    databases.createDocument(databaseId(), APPWRITE.TABLES.AUDIT_LOGS, ID.unique(), {
      actorId: 'system',
      organizationId: event.organizationId,
      action: 'event.personal_data_erased',
      target: `events/${event.$id}`,
      metadata: JSON.stringify({
        closedAt: eventClosedAt(event).toISOString(),
        retentionDays: RETENTION_DAYS,
        payments,
        tickets,
      }),
    })
  )
  return { payments, tickets }
}

/** Deletes USSD session rows (each holds the caller's number) a day after they expired. */
async function pruneUssdSessions(now: Date): Promise<number> {
  const { databases } = createAdminClient()
  const cutoff = new Date(now.getTime() - USSD_SESSION_KEEP_MS).toISOString()
  let deleted = 0
  for (;;) {
    const page = await withRetry(() =>
      databases.listDocuments(databaseId(), APPWRITE.TABLES.USSD_SESSIONS, [
        Query.lessThan('expiresAt', cutoff),
        Query.limit(PAGE),
      ])
    )
    for (const s of page.documents) {
      await withRetry(() => databases.deleteDocument(databaseId(), APPWRITE.TABLES.USSD_SESSIONS, s.$id))
      deleted += 1
    }
    if (page.documents.length < PAGE) return deleted
  }
}

/**
 * Erases personal data for every closed event past the retention period, at
 * most `MAX_EVENTS_PER_RUN` events per run, then prunes old USSD sessions.
 */
export async function erasePersonalData(opts: { now?: Date } = {}): Promise<ErasureTotals> {
  const now = opts.now ?? new Date()
  const totals: ErasureTotals = { events: 0, payments: 0, tickets: 0, ussdSessions: 0 }

  const due: Doc<EventDoc>[] = []
  await eachPage<EventDoc>(
    APPWRITE.TABLES.EVENTS,
    [Query.equal('status', ['closed']), Query.isNull('personalDataErasedAt')],
    async (docs) => {
      for (const e of docs) if (due.length < MAX_EVENTS_PER_RUN && isDueForErasure(e, now)) due.push(e)
    }
  )

  for (const event of due) {
    const done = await eraseEvent(event, now)
    totals.events += 1
    totals.payments += done.payments
    totals.tickets += done.tickets
  }

  totals.ussdSessions = await pruneUssdSessions(now)
  return totals
}
