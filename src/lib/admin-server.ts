import { ID, Query } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { APPWRITE } from './constants'
import { databaseId, getOrganization, runInTransaction, type Doc, type TenantContext } from './db'
import { isValidBps } from './fees'
import { balanceFor, type Balance } from './ledger-server'
import { maskPhone } from './phone'
import type {
  AuditLogDoc,
  EventDoc,
  MembershipDoc,
  OrganizationDoc,
  OrganizationStatus,
  PaymentDoc,
  PaymentPurpose,
  PaymentStatus,
  UserDoc,
} from './types'

/**
 * Super admin console (PRD 5.7): platform-wide reads and the organization
 * controls only the platform owner holds (suspension, commission override,
 * the morale-candidate and free-vote switches of PRD 5.4a).
 *
 * Deliberately cross-tenant. Every caller must have passed
 * `requireSuperAdmin()` first; nothing here checks membership. Every change
 * writes an audit row against the organization.
 *
 * Payer phone numbers are masked here like everywhere outside an
 * organization's own managers (#28, decided 2026-11-12).
 */

export const ADMIN_PAGE_SIZE = 25

const db = () => databaseId()

export class AdminError extends Error {
  constructor(public readonly problem: 'notFound' | 'invalid' | 'noChange') {
    super(problem)
    this.name = 'AdminError'
  }
}

/** One page: `next` is the cursor for the following page, or null at the end. */
export type Page<T> = { items: T[]; next: string | null }

async function listPage<T extends { $id: string }>(
  table: string,
  queries: string[],
  after?: string | null
): Promise<Page<T>> {
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<Doc<T & Record<string, unknown>>>(db(), table, [
      ...queries,
      Query.orderDesc('$createdAt'),
      Query.limit(ADMIN_PAGE_SIZE + 1),
      ...(after ? [Query.cursorAfter(after)] : []),
    ])
  )
  const docs = res.documents as unknown as T[]
  const items = docs.slice(0, ADMIN_PAGE_SIZE)
  return { items, next: docs.length > ADMIN_PAGE_SIZE ? items[items.length - 1].$id : null }
}

async function count(table: string, queries: string[]): Promise<number> {
  const { databases } = createAdminClient()
  const res = await withRetry(() => databases.listDocuments(db(), table, [...queries, Query.limit(1)]))
  return res.total
}

// ─── Overview ───────────────────────────────────────────────────

export interface PlatformOverview {
  organizations: number
  suspended: number
  pendingPayouts: number
  pendingPayments: number
}

export async function platformOverview(): Promise<PlatformOverview> {
  const T = APPWRITE.TABLES
  const [organizations, suspended, pendingPayouts, pendingPayments] = await Promise.all([
    count(T.ORGANIZATIONS, []),
    count(T.ORGANIZATIONS, [Query.equal('status', 'suspended')]),
    count(T.PAYOUTS, [Query.equal('status', ['requested', 'approved'])]),
    count(T.PAYMENTS, [Query.equal('status', 'pending')]),
  ])
  return { organizations, suspended, pendingPayouts, pendingPayments }
}

// ─── Organizations ──────────────────────────────────────────────

export async function listOrganizationsPage(
  filter: { status?: OrganizationStatus; search?: string } = {},
  after?: string | null
): Promise<Page<Doc<OrganizationDoc>>> {
  const queries: string[] = []
  if (filter.status) queries.push(Query.equal('status', filter.status))
  const search = filter.search?.trim().toLowerCase()
  // Slugs are lowercase and indexed; a prefix match finds an organization by its URL name.
  if (search) queries.push(Query.startsWith('slug', search.replace(/[^a-z0-9-]/g, '')))
  return listPage<Doc<OrganizationDoc>>(APPWRITE.TABLES.ORGANIZATIONS, queries, after)
}

export interface OrganizationDetail {
  organization: Doc<OrganizationDoc>
  owners: { userId: string; name: string; email: string }[]
  members: number
  events: Pick<Doc<EventDoc>, '$id' | 'title' | 'slug' | 'status' | '$createdAt'>[]
  balance: Balance
}

export async function getOrganizationDetail(organizationId: string): Promise<OrganizationDetail> {
  const organization = await getOrganization(organizationId)
  if (!organization) throw new AdminError('notFound')
  const { databases } = createAdminClient()
  const T = APPWRITE.TABLES
  const ctx: TenantContext = { organizationId, userId: 'super-admin', role: 'owner' }
  const [memberships, events, balance] = await Promise.all([
    withRetry(() =>
      databases.listDocuments<Doc<MembershipDoc>>(db(), T.MEMBERSHIPS, [
        Query.equal('organizationId', organizationId),
        Query.limit(500),
      ])
    ),
    withRetry(() =>
      databases.listDocuments<Doc<EventDoc>>(db(), T.EVENTS, [
        Query.equal('organizationId', organizationId),
        Query.orderDesc('$createdAt'),
        Query.limit(100),
      ])
    ),
    balanceFor(ctx),
  ])
  const ownerIds = memberships.documents.filter((m) => m.role === 'owner').map((m) => m.userId)
  const users = ownerIds.length
    ? await withRetry(() =>
        databases.listDocuments<Doc<UserDoc>>(db(), T.USERS, [Query.equal('$id', ownerIds), Query.limit(100)])
      )
    : { documents: [] as Doc<UserDoc>[] }
  const byId = new Map(users.documents.map((u) => [u.$id, u]))
  return {
    organization,
    owners: ownerIds.map((id) => ({
      userId: id,
      name: byId.get(id)?.fullName ?? '',
      email: byId.get(id)?.email ?? '',
    })),
    members: memberships.documents.length,
    events: events.documents.map((e) => ({
      $id: e.$id,
      title: e.title,
      slug: e.slug,
      status: e.status,
      $createdAt: e.$createdAt,
    })),
    balance,
  }
}

export interface OrganizationSettingsPatch {
  status?: OrganizationStatus
  /** Basis points, or null for the platform default. */
  commissionRate?: number | null
  moraleCandidatesEnabled?: boolean
  freeVotesEnabled?: boolean
  /** Why; kept in the audit row. Required to suspend. */
  reason?: string
}

/** Validate an untrusted request body into a patch, or throw `invalid`. */
export function parseSettingsPatch(body: unknown): OrganizationSettingsPatch {
  if (typeof body !== 'object' || body === null) throw new AdminError('invalid')
  const b = body as Record<string, unknown>
  const patch: OrganizationSettingsPatch = {}
  if ('status' in b) {
    if (b.status !== 'active' && b.status !== 'suspended') throw new AdminError('invalid')
    patch.status = b.status
  }
  if ('commissionRate' in b) {
    if (b.commissionRate !== null && !isValidBps(b.commissionRate)) throw new AdminError('invalid')
    patch.commissionRate = b.commissionRate as number | null
  }
  for (const key of ['moraleCandidatesEnabled', 'freeVotesEnabled'] as const) {
    if (key in b) {
      if (typeof b[key] !== 'boolean') throw new AdminError('invalid')
      patch[key] = b[key] as boolean
    }
  }
  if ('reason' in b) {
    if (typeof b.reason !== 'string') throw new AdminError('invalid')
    patch.reason = b.reason.trim().slice(0, 500)
  }
  if (patch.status === 'suspended' && !patch.reason) throw new AdminError('invalid')
  return patch
}

const SETTING_KEYS = ['status', 'commissionRate', 'moraleCandidatesEnabled', 'freeVotesEnabled'] as const

/**
 * Apply a super admin's change to an organization and audit it.
 *
 * - Suspension hides the organization's public pages and refuses new votes and
 *   ticket purchases (`quoteVote`, `initiateTicketPayment`). Payments already
 *   started still confirm when the provider reports them: the voter has paid.
 * - A commission change applies to payments initiated afterwards; each
 *   payment keeps the split computed when it started.
 * - The switches take effect on the next morale-candidate creation or
 *   free-vote grant.
 */
export async function updateOrganizationSettings(
  adminUserId: string,
  organizationId: string,
  patch: OrganizationSettingsPatch
): Promise<Doc<OrganizationDoc>> {
  const before = await getOrganization(organizationId)
  if (!before) throw new AdminError('notFound')

  const changes: Partial<Pick<OrganizationDoc, (typeof SETTING_KEYS)[number]>> = {}
  for (const key of SETTING_KEYS) {
    if (patch[key] === undefined) continue
    const current = key === 'commissionRate' ? (before.commissionRate ?? null) : before[key]
    if (patch[key] !== current) Object.assign(changes, { [key]: patch[key] })
  }
  if (Object.keys(changes).length === 0) throw new AdminError('noChange')

  const action =
    changes.status === 'suspended'
      ? 'organization.suspend'
      : changes.status === 'active'
        ? 'organization.reactivate'
        : 'organization.settings'
  const metadata = {
    before: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as keyof OrganizationDoc] ?? null])),
    after: changes,
    ...(patch.reason ? { reason: patch.reason } : {}),
  }

  // The change and its audit row commit together: no unaudited change, no audit of a change that failed.
  const { databases } = createAdminClient()
  await runInTransaction(async (tx) => {
    await databases.updateDocument(db(), APPWRITE.TABLES.ORGANIZATIONS, organizationId, changes, undefined, tx)
    await databases.createDocument(
      db(),
      APPWRITE.TABLES.AUDIT_LOGS,
      ID.unique(),
      {
        actorId: adminUserId,
        organizationId,
        action,
        target: `organizations/${organizationId}`,
        metadata: JSON.stringify(metadata),
      },
      undefined,
      tx
    )
  })
  const updated = await getOrganization(organizationId)
  if (!updated) throw new AdminError('notFound')
  return updated
}

// ─── Transactions ───────────────────────────────────────────────

export interface TransactionView {
  id: string
  createdAt: string
  organizationId: string
  eventId: string
  purpose: PaymentPurpose
  channel: string
  status: PaymentStatus
  provider: string
  providerReference: string
  network: string | null
  quantity: number
  amount: number
  platformFee: number
  organizerNet: number
  /** The provider's charge taken off the top; null when none was taken. */
  providerFee: number | null
  payerPhone: string
  confirmedAt: string | null
}

export function transactionView(p: Doc<PaymentDoc>): TransactionView {
  return {
    id: p.$id,
    createdAt: p.$createdAt,
    organizationId: p.organizationId,
    eventId: p.eventId,
    purpose: p.purpose,
    channel: p.channel,
    status: p.status,
    provider: p.provider,
    providerReference: p.providerReference,
    network: p.network ?? null,
    quantity: p.quantity,
    amount: p.amount,
    platformFee: p.platformFee,
    organizerNet: p.organizerNet,
    providerFee: p.providerFee ?? null,
    payerPhone: maskPhone(p.payerPhone),
    confirmedAt: p.confirmedAt ?? null,
  }
}

export interface TransactionFilter {
  status?: PaymentStatus
  purpose?: PaymentPurpose
  organizationId?: string
}

export async function listTransactionsPage(
  filter: TransactionFilter = {},
  after?: string | null
): Promise<Page<TransactionView>> {
  const queries: string[] = []
  if (filter.organizationId) queries.push(Query.equal('organizationId', filter.organizationId))
  if (filter.status) queries.push(Query.equal('status', filter.status))
  if (filter.purpose) queries.push(Query.equal('purpose', filter.purpose))
  const page = await listPage<Doc<PaymentDoc>>(APPWRITE.TABLES.PAYMENTS, queries, after)
  return { items: page.items.map(transactionView), next: page.next }
}

/** Find one payment by our id or the provider's reference (what a payer quotes in a dispute). */
export async function findTransaction(ref: string): Promise<TransactionView | null> {
  const value = ref.trim()
  if (!value || value.length > 128) return null
  const { databases } = createAdminClient()
  const T = APPWRITE.TABLES.PAYMENTS
  try {
    return transactionView(await withRetry(() => databases.getDocument<Doc<PaymentDoc>>(db(), T, value)))
  } catch (err) {
    if ((err as { code?: number })?.code !== 404 && (err as { code?: number })?.code !== 400) throw err
  }
  const res = await withRetry(() =>
    databases.listDocuments<Doc<PaymentDoc>>(db(), T, [Query.equal('providerReference', value), Query.limit(1)])
  )
  return res.documents[0] ? transactionView(res.documents[0]) : null
}

// ─── Audit log ──────────────────────────────────────────────────

export async function listAuditPage(
  filter: { organizationId?: string } = {},
  after?: string | null
): Promise<Page<Doc<AuditLogDoc>>> {
  const queries = filter.organizationId ? [Query.equal('organizationId', filter.organizationId)] : []
  return listPage<Doc<AuditLogDoc>>(APPWRITE.TABLES.AUDIT_LOGS, queries, after)
}

/** Names for a set of organization ids, for labelling cross-tenant lists. */
export async function organizationNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (unique.length === 0) return new Map()
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<Doc<OrganizationDoc>>(db(), APPWRITE.TABLES.ORGANIZATIONS, [
      Query.equal('$id', unique),
      Query.limit(100),
    ])
  )
  return new Map(res.documents.map((o) => [o.$id, o.name]))
}

/** Display names for a set of user ids (audit actors). */
export async function userNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<Doc<UserDoc>>(db(), APPWRITE.TABLES.USERS, [Query.equal('$id', unique), Query.limit(100)])
  )
  return new Map(res.documents.map((u) => [u.$id, u.fullName || u.email]))
}
