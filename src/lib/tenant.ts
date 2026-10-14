import { getSessionUserId } from './auth-session'
import { findMembership, type TenantContext } from './db'

/**
 * Builds the `TenantContext` every tenant-scoped query needs (CLAUDE.md
 * rule 4). The organization id may come from the URL or the request body, but
 * it is only honoured once the caller's Membership in that organization has
 * been found server-side.
 */
export class NotAMemberError extends Error {
  constructor(organizationId: string) {
    super(`Caller is not a member of organization ${organizationId}`)
    this.name = 'NotAMemberError'
  }
}

export async function getTenantContext(userId: string, organizationId: string): Promise<TenantContext> {
  if (!userId || !organizationId) throw new NotAMemberError(organizationId)
  const membership = await findMembership(userId, organizationId)
  if (!membership) throw new NotAMemberError(organizationId)
  return { organizationId, userId, role: membership.role }
}

/**
 * Same, from the signed session cookie. Returns `null` when there is no
 * session, and throws `NotAMemberError` when there is one without membership,
 * so route handlers can answer 401 and 403 respectively.
 */
export async function requireTenantContext(organizationId: string): Promise<TenantContext | null> {
  const userId = await getSessionUserId()
  if (!userId) return null
  return getTenantContext(userId, organizationId)
}
