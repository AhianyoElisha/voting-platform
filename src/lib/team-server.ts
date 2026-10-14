import { ID, Query } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { writeAuditLog } from './audit'
import { APPWRITE } from './constants'
import {
  createTenantDocument,
  databaseId,
  getOrganization,
  getTenantDocument,
  getUserDoc,
  listTenantDocuments,
  updateTenantDocument,
  type TenantContext,
} from './db'
import { getEmailProvider, type EmailProvider } from './email'
import { checkInviteToken, generateInviteToken, hashInviteToken } from './invite-token'
import { normalizeEmail } from './nominees-server'
import { assertCanManage } from './tenant'
import type { InvitableRole, MembershipDoc, MembershipRole, TeamInviteDoc, UserDoc } from './types'

/**
 * Team membership (PRD 5.1, roles decision of 2026-10-14). Owners and admins
 * invite and manage. Nobody is invited as owner, an owner's role is never
 * changed here, and the last owner cannot be removed. Acceptance needs the
 * token, a signed-in user, and that user's email matching the invite.
 */
export const INVITABLE_ROLES: readonly InvitableRole[] = ['admin', 'staff', 'designer', 'scanner']

export type TeamProblem =
  | 'emailInvalid'
  | 'roleInvalid'
  | 'alreadyMember'
  | 'alreadyInvited'
  | 'notPending'
  | 'tokenInvalid'
  | 'tokenExpired'
  | 'tokenUsed'
  | 'emailMismatch'
  | 'ownerImmutable'
  | 'lastOwner'
  | 'selfChange'

export class TeamError extends Error {
  constructor(public readonly problem: TeamProblem) {
    super(`Team: ${problem}`)
    this.name = 'TeamError'
  }
}

export function isInvitableRole(role: unknown): role is InvitableRole {
  return INVITABLE_ROLES.includes(role as InvitableRole)
}

function acceptUrl(token: string, baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'): string {
  return `${baseUrl.replace(/\/$/, '')}/team/accept/${token}`
}

export interface MemberRow {
  membership: MembershipDoc
  user: Pick<UserDoc, '$id' | 'fullName' | 'email'> | null
}

export async function listMembers(ctx: TenantContext): Promise<MemberRow[]> {
  const memberships = await listTenantDocuments<MembershipDoc>(ctx, APPWRITE.TABLES.MEMBERSHIPS, [Query.limit(200)])
  const ids = memberships.documents.map((m) => m.userId)
  const { databases } = createAdminClient()
  const users = ids.length
    ? await withRetry(() =>
        databases.listDocuments<UserDoc>(databaseId(), APPWRITE.TABLES.USERS, [
          Query.equal('$id', ids),
          Query.limit(200),
        ])
      )
    : { documents: [] as UserDoc[] }
  const byId = new Map(users.documents.map((u) => [u.$id, u]))
  return memberships.documents.map((membership) => {
    const u = byId.get(membership.userId)
    return { membership, user: u ? { $id: u.$id, fullName: u.fullName, email: u.email } : null }
  })
}

async function memberByEmail(ctx: TenantContext, email: string): Promise<boolean> {
  const { databases } = createAdminClient()
  const users = await withRetry(() =>
    databases.listDocuments<UserDoc>(databaseId(), APPWRITE.TABLES.USERS, [
      Query.equal('email', [email]),
      Query.limit(1),
    ])
  )
  const user = users.documents[0]
  if (!user) return false
  const res = await listTenantDocuments<MembershipDoc>(ctx, APPWRITE.TABLES.MEMBERSHIPS, [
    Query.equal('userId', [user.$id]),
    Query.limit(1),
  ])
  return res.documents.length > 0
}

export interface InviteOutcome {
  invite: TeamInviteDoc
  emailSent: boolean
  /** Only when the email was not sent, so the organizer can share it. */
  acceptUrl: string | null
}

export async function inviteMember(
  ctx: TenantContext,
  input: { email: string; role: unknown },
  opts: { email?: EmailProvider; baseUrl?: string } = {}
): Promise<InviteOutcome> {
  assertCanManage(ctx)
  let email: string | null
  try {
    email = normalizeEmail(input.email)
  } catch {
    throw new TeamError('emailInvalid')
  }
  if (!email) throw new TeamError('emailInvalid')
  if (!isInvitableRole(input.role)) throw new TeamError('roleInvalid')
  if (await memberByEmail(ctx, email)) throw new TeamError('alreadyMember')
  const pending = await listTenantDocuments<TeamInviteDoc>(ctx, APPWRITE.TABLES.TEAM_INVITES, [
    Query.equal('email', [email]),
    Query.equal('status', ['pending']),
    Query.limit(1),
  ])
  if (pending.documents[0]) throw new TeamError('alreadyInvited')

  const { token, hash, expiresAt } = generateInviteToken()
  const invite = await createTenantDocument<TeamInviteDoc>(ctx, APPWRITE.TABLES.TEAM_INVITES, {
    email,
    role: input.role,
    tokenHash: hash,
    expiresAt,
    invitedBy: ctx.userId,
    status: 'pending',
    acceptedBy: null,
    acceptedAt: null,
  })
  const sent = await send(ctx, invite, token, opts)
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'team.invite',
    target: `team_invites/${invite.$id}`,
    metadata: { role: input.role, emailSent: sent.sent },
  })
  return { invite, emailSent: sent.sent, acceptUrl: sent.sent ? null : acceptUrl(token, opts.baseUrl) }
}

async function send(
  ctx: TenantContext,
  invite: TeamInviteDoc,
  token: string,
  opts: { email?: EmailProvider; baseUrl?: string }
) {
  const [organization, inviter] = await Promise.all([getOrganization(ctx.organizationId), getUserDoc(ctx.userId)])
  const provider = opts.email ?? getEmailProvider()
  return provider.sendTeamInvite({
    to: invite.email,
    organizationName: organization?.name ?? '',
    role: invite.role,
    inviterName: inviter?.fullName ?? '',
    acceptUrl: acceptUrl(token, opts.baseUrl),
  })
}

/** A fresh token; the old link dies. */
export async function resendInvite(
  ctx: TenantContext,
  inviteId: string,
  opts: { email?: EmailProvider; baseUrl?: string } = {}
): Promise<InviteOutcome> {
  assertCanManage(ctx)
  const invite = await getTenantDocument<TeamInviteDoc>(ctx, APPWRITE.TABLES.TEAM_INVITES, inviteId)
  if (invite.status !== 'pending') throw new TeamError('notPending')
  const { token, hash, expiresAt } = generateInviteToken()
  const updated = await updateTenantDocument<TeamInviteDoc>(ctx, APPWRITE.TABLES.TEAM_INVITES, inviteId, {
    tokenHash: hash,
    expiresAt,
  })
  const sent = await send(ctx, updated, token, opts)
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'team.invite_resend',
    target: `team_invites/${inviteId}`,
  })
  return { invite: updated, emailSent: sent.sent, acceptUrl: sent.sent ? null : acceptUrl(token, opts.baseUrl) }
}

export async function revokeInvite(ctx: TenantContext, inviteId: string): Promise<TeamInviteDoc> {
  assertCanManage(ctx)
  const invite = await getTenantDocument<TeamInviteDoc>(ctx, APPWRITE.TABLES.TEAM_INVITES, inviteId)
  if (invite.status !== 'pending') throw new TeamError('notPending')
  const updated = await updateTenantDocument<TeamInviteDoc>(ctx, APPWRITE.TABLES.TEAM_INVITES, inviteId, {
    status: 'revoked',
    tokenHash: null,
    expiresAt: null,
  })
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'team.invite_revoke',
    target: `team_invites/${inviteId}`,
  })
  return updated
}

export async function listInvites(ctx: TenantContext): Promise<TeamInviteDoc[]> {
  const res = await listTenantDocuments<TeamInviteDoc>(ctx, APPWRITE.TABLES.TEAM_INVITES, [
    Query.orderDesc('$createdAt'),
    Query.limit(100),
  ])
  return res.documents
}

/** The invite behind a token, for the accept page; null when unknown. */
export async function findInviteByToken(token: string): Promise<TeamInviteDoc | null> {
  if (!token || token.length < 16) return null
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<TeamInviteDoc>(databaseId(), APPWRITE.TABLES.TEAM_INVITES, [
      Query.equal('tokenHash', [hashInviteToken(token)]),
      Query.limit(1),
    ])
  )
  return res.documents[0] ?? null
}

/**
 * Creates the Membership for the signed-in user. The token proves the
 * invite, the session proves the person, and the email on the account must
 * match the email that was invited, so a forwarded link admits nobody who
 * already has an account on another address. Until an email provider exists
 * (#32) nothing verifies ownership of a brand-new account's address, so the
 * link itself is the credential and must be sent to the person directly.
 */
export async function acceptInvite(
  userId: string,
  token: string
): Promise<{ membership: MembershipDoc; invite: TeamInviteDoc }> {
  const invite = await findInviteByToken(token)
  if (!invite) throw new TeamError('tokenInvalid')
  const check = checkInviteToken(token, {
    inviteTokenHash: invite.tokenHash,
    inviteExpiresAt: invite.expiresAt,
    claimedAt: invite.acceptedAt,
  })
  if (check === 'used' || invite.status === 'accepted') throw new TeamError('tokenUsed')
  if (invite.status !== 'pending') throw new TeamError('tokenInvalid')
  if (check === 'expired') throw new TeamError('tokenExpired')
  if (check !== 'ok') throw new TeamError('tokenInvalid')
  const user = await getUserDoc(userId)
  if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) throw new TeamError('emailMismatch')

  const ctx: TenantContext = { organizationId: invite.organizationId, userId, role: 'owner' }
  const existing = await listTenantDocuments<MembershipDoc>(ctx, APPWRITE.TABLES.MEMBERSHIPS, [
    Query.equal('userId', [userId]),
    Query.limit(1),
  ])
  const { databases } = createAdminClient()
  let membership = existing.documents[0]
  if (!membership) {
    try {
      membership = await withRetry(() =>
        databases.createDocument<MembershipDoc>(databaseId(), APPWRITE.TABLES.MEMBERSHIPS, ID.unique(), {
          userId,
          organizationId: invite.organizationId,
          role: invite.role,
        })
      )
    } catch (err) {
      // Accepted twice at once: the other call created it; the unique index on user + organization says so.
      if ((err as { code?: number })?.code !== 409) throw err
      const again = await listTenantDocuments<MembershipDoc>(ctx, APPWRITE.TABLES.MEMBERSHIPS, [
        Query.equal('userId', [userId]),
        Query.limit(1),
      ])
      membership = again.documents[0]
      if (!membership) throw err
    }
  }
  const accepted = await withRetry(() =>
    databases.updateDocument<TeamInviteDoc>(databaseId(), APPWRITE.TABLES.TEAM_INVITES, invite.$id, {
      status: 'accepted',
      tokenHash: null,
      expiresAt: null,
      acceptedBy: userId,
      acceptedAt: new Date().toISOString(),
    })
  )
  await writeAuditLog({
    actorId: userId,
    organizationId: invite.organizationId,
    action: 'team.invite_accept',
    target: `memberships/${membership.$id}`,
    metadata: { role: membership.role },
  })
  return { membership, invite: accepted }
}

async function ownerCount(ctx: TenantContext): Promise<number> {
  const res = await listTenantDocuments<MembershipDoc>(ctx, APPWRITE.TABLES.MEMBERSHIPS, [
    Query.equal('role', ['owner']),
    Query.limit(50),
  ])
  return res.documents.length
}

export async function changeRole(ctx: TenantContext, membershipId: string, role: unknown): Promise<MembershipDoc> {
  assertCanManage(ctx)
  if (!isInvitableRole(role)) throw new TeamError('roleInvalid')
  const membership = await getTenantDocument<MembershipDoc>(ctx, APPWRITE.TABLES.MEMBERSHIPS, membershipId)
  if (membership.userId === ctx.userId) throw new TeamError('selfChange')
  if (membership.role === 'owner') throw new TeamError('ownerImmutable')
  const updated = await updateTenantDocument<MembershipDoc>(ctx, APPWRITE.TABLES.MEMBERSHIPS, membershipId, {
    role: role as MembershipRole,
  })
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'team.role_change',
    target: `memberships/${membershipId}`,
    metadata: { from: membership.role, to: role },
  })
  return updated
}

export async function removeMember(ctx: TenantContext, membershipId: string): Promise<void> {
  assertCanManage(ctx)
  const membership = await getTenantDocument<MembershipDoc>(ctx, APPWRITE.TABLES.MEMBERSHIPS, membershipId)
  if (membership.userId === ctx.userId) throw new TeamError('selfChange')
  if (membership.role === 'owner') {
    if (ctx.role !== 'owner') throw new TeamError('ownerImmutable')
    if ((await ownerCount(ctx)) <= 1) throw new TeamError('lastOwner')
  }
  const { databases } = createAdminClient()
  await withRetry(() => databases.deleteDocument(databaseId(), APPWRITE.TABLES.MEMBERSHIPS, membershipId))
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'team.remove',
    target: `memberships/${membershipId}`,
    metadata: { userId: membership.userId, role: membership.role },
  })
}
