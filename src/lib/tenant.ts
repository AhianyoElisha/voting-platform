import { getSessionUserId } from './auth-session'
import { findMembership, type TenantContext } from './db'
import type { MembershipRole } from './types'

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

// ─── Roles ─────────────────────────────────────────────────────

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/** Roles that may create and change events, categories, nominees and rounds. */
export const MANAGER_ROLES: readonly MembershipRole[] = ['owner', 'admin']

export function canManage(role: MembershipRole): boolean {
  return MANAGER_ROLES.includes(role)
}

export function assertCanManage(ctx: TenantContext): void {
  if (!canManage(ctx.role)) throw new ForbiddenError(`Role ${ctx.role} cannot manage this organization`)
}

/** Roles that may create and edit flyer templates and fonts (FLYER_ENGINE.md; #17 placeholder: organization-owned templates). */
export const DESIGNER_ROLES: readonly MembershipRole[] = ['owner', 'admin', 'designer']

export function canDesign(role: MembershipRole): boolean {
  return DESIGNER_ROLES.includes(role)
}

export function assertCanDesign(ctx: TenantContext): void {
  if (!canDesign(ctx.role)) throw new ForbiddenError(`Role ${ctx.role} cannot edit templates`)
}
