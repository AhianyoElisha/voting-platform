import { Query, type Models } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import type { TenantDoc } from './types'

/**
 * Tenant-scoped data access (CLAUDE.md rule 4).
 *
 * Route handlers and Appwrite Functions never query tenant-owned collections
 * directly: they go through these helpers, which take a `TenantContext` and
 * add the `organizationId` filter themselves. The context is built server-side
 * from the session and the caller's Membership, never from a client-supplied
 * organization ID.
 *
 * Empty on purpose beyond the two primitives: collections arrive with the data
 * model (DATA_MODEL.md), and each one gets its own typed helpers here.
 */
export interface TenantContext {
  organizationId: string
  /** Appwrite Auth user ID of the caller. */
  userId: string
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
