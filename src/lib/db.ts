import { ID, Query, type Models } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { APPWRITE } from './constants'
import type { MembershipDoc, MembershipRole, OrganizationDoc, TenantDoc, UserDoc } from './types'

/**
 * Tenant-scoped data access (CLAUDE.md rule 4).
 *
 * Route handlers and Appwrite Functions never query tenant-owned tables
 * directly: they go through these helpers, which take a `TenantContext` and
 * add the `organizationId` filter themselves. The context is built server-side
 * from the session and the caller's Membership (`tenant.ts`), never from a
 * client-supplied organization ID.
 *
 * Platform-level tables (`users`, `organizations`, `memberships`) are not
 * tenant-owned and have their own helpers below.
 */
export interface TenantContext {
  organizationId: string
  /** Appwrite Auth user ID of the caller. */
  userId: string
  /** The caller's role in this organization. */
  role: MembershipRole
}

export class TenantMismatchError extends Error {
  constructor(collectionId: string, documentId: string) {
    super(`Document ${collectionId}/${documentId} does not belong to the caller's organization`)
    this.name = 'TenantMismatchError'
  }
}

export function databaseId(): string {
  const id = process.env.APPWRITE_DATABASE_ID
  if (!id) throw new Error('APPWRITE_DATABASE_ID is not set')
  return id
}

/** The `organizationId` filter every tenant query starts with. */
export function tenantQueries(ctx: TenantContext, queries: string[] = []): string[] {
  return [Query.equal('organizationId', [ctx.organizationId]), ...queries]
}

export async function listTenantDocuments<T extends TenantDoc>(
  ctx: TenantContext,
  collectionId: string,
  queries: string[] = []
): Promise<Models.DocumentList<T & Models.Document>> {
  const { databases } = createAdminClient()
  return withRetry(() =>
    databases.listDocuments<T & Models.Document>(databaseId(), collectionId, tenantQueries(ctx, queries))
  )
}

/** Fetch one document and refuse it if it belongs to another organization. */
export async function getTenantDocument<T extends TenantDoc>(
  ctx: TenantContext,
  collectionId: string,
  documentId: string
): Promise<T & Models.Document> {
  const { databases } = createAdminClient()
  const doc = await withRetry(() => databases.getDocument<T & Models.Document>(databaseId(), collectionId, documentId))
  if (doc.organizationId !== ctx.organizationId) {
    throw new TenantMismatchError(collectionId, documentId)
  }
  return doc
}

/** Create a tenant-owned document. `organizationId` comes from the context, never the data. */
export async function createTenantDocument<T extends TenantDoc>(
  ctx: TenantContext,
  collectionId: string,
  data: Omit<T, keyof TenantDoc>,
  documentId: string = ID.unique()
): Promise<T & Models.Document> {
  const { databases } = createAdminClient()
  // The SDK types `data` with a conditional on the generic, which cannot
  // resolve for an open `T`; write untyped and assert the row type on the way out.
  const payload: Record<string, unknown> = { ...data, organizationId: ctx.organizationId }
  const doc = await withRetry(() => databases.createDocument(databaseId(), collectionId, documentId, payload))
  return doc as unknown as T & Models.Document
}

/** Update a tenant-owned document after confirming it belongs to the caller's organization. */
export async function updateTenantDocument<T extends TenantDoc>(
  ctx: TenantContext,
  collectionId: string,
  documentId: string,
  data: Partial<Omit<T, keyof TenantDoc>>
): Promise<T & Models.Document> {
  await getTenantDocument<T>(ctx, collectionId, documentId)
  const { databases } = createAdminClient()
  const payload = data as Record<string, unknown>
  const doc = await withRetry(() => databases.updateDocument(databaseId(), collectionId, documentId, payload))
  return doc as unknown as T & Models.Document
}

/** Delete a tenant-owned document after confirming it belongs to the caller's organization. */
export async function deleteTenantDocument<T extends TenantDoc>(
  ctx: TenantContext,
  collectionId: string,
  documentId: string
): Promise<void> {
  await getTenantDocument<T>(ctx, collectionId, documentId)
  const { databases } = createAdminClient()
  await withRetry(() => databases.deleteDocument(databaseId(), collectionId, documentId))
}

// ─── Platform-level helpers ────────────────────────────────────

type Doc<T> = T & Models.Document

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: number }).code === 404
}

export async function getUserDoc(authId: string): Promise<Doc<UserDoc> | null> {
  const { databases } = createAdminClient()
  try {
    return await withRetry(() => databases.getDocument<Doc<UserDoc>>(databaseId(), APPWRITE.TABLES.USERS, authId))
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function getOrganization(organizationId: string): Promise<Doc<OrganizationDoc> | null> {
  const { databases } = createAdminClient()
  try {
    return await withRetry(() =>
      databases.getDocument<Doc<OrganizationDoc>>(databaseId(), APPWRITE.TABLES.ORGANIZATIONS, organizationId)
    )
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function getOrganizationBySlug(slug: string): Promise<Doc<OrganizationDoc> | null> {
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<Doc<OrganizationDoc>>(databaseId(), APPWRITE.TABLES.ORGANIZATIONS, [
      Query.equal('slug', [slug]),
      Query.limit(1),
    ])
  )
  return res.documents[0] ?? null
}

/** The caller's membership in one organization, or null when they have none. */
export async function findMembership(userId: string, organizationId: string): Promise<Doc<MembershipDoc> | null> {
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<Doc<MembershipDoc>>(databaseId(), APPWRITE.TABLES.MEMBERSHIPS, [
      Query.equal('userId', [userId]),
      Query.equal('organizationId', [organizationId]),
      Query.limit(1),
    ])
  )
  return res.documents[0] ?? null
}

export async function listMembershipsForUser(userId: string): Promise<Doc<MembershipDoc>[]> {
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<Doc<MembershipDoc>>(databaseId(), APPWRITE.TABLES.MEMBERSHIPS, [
      Query.equal('userId', [userId]),
      Query.limit(100),
    ])
  )
  return res.documents
}

/** Memberships plus their organizations, for the dashboard's workspace list. */
export async function listOrganizationsForUser(
  userId: string
): Promise<{ membership: Doc<MembershipDoc>; organization: Doc<OrganizationDoc> }[]> {
  const memberships = await listMembershipsForUser(userId)
  if (memberships.length === 0) return []
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<Doc<OrganizationDoc>>(databaseId(), APPWRITE.TABLES.ORGANIZATIONS, [
      Query.equal(
        '$id',
        memberships.map((m) => m.organizationId)
      ),
      Query.limit(100),
    ])
  )
  const byId = new Map(res.documents.map((o) => [o.$id, o]))
  return memberships.flatMap((membership) => {
    const organization = byId.get(membership.organizationId)
    return organization ? [{ membership, organization }] : []
  })
}

export { ID }
