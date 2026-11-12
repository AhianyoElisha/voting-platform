import { ID, Query } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { writeAuditLog } from './audit'
import { APPWRITE } from './constants'
import { databaseId, getOrganization, getTenantDocument, updateTenantDocument, type TenantContext } from './db'
import { getEmailProvider, type EmailProvider } from './email'
import { checkInviteToken, generateInviteToken, hashInviteToken } from './invite-token'
import { assertCanManage } from './tenant'
import type { EventDoc, NomineeDoc } from './types'

/**
 * Nominee invites (PRD 5.2a). The organizer invites a nominee; the nominee
 * receives a one-time claim link, sets a password, and signs in to the portal.
 * No password is ever emailed. While no email provider is configured (#32),
 * the route hands the link back so the organizer can share it directly.
 *
 * An email that already has an account is only linked, never password-reset:
 * the organizer holding an invite link must not be able to take over someone
 * else's login.
 */
export type InviteProblem = 'noEmail' | 'alreadyClaimed' | 'eventClosed' | 'wrongEvent'
export type ClaimProblem = 'invalid' | 'expired' | 'used' | 'passwordTooShort'

export class InviteError extends Error {
  constructor(public readonly problem: InviteProblem) {
    super(`Invite: ${problem}`)
    this.name = 'InviteError'
  }
}

export class ClaimError extends Error {
  constructor(public readonly problem: ClaimProblem) {
    super(`Claim: ${problem}`)
    this.name = 'ClaimError'
  }
}

export const PASSWORD_MIN = 8

function appUrl(baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'): string {
  return baseUrl.replace(/\/$/, '')
}

export function claimUrl(token: string, baseUrl?: string): string {
  return `${appUrl(baseUrl)}/portal/claim/${token}`
}

export function signInUrl(baseUrl?: string): string {
  return `${appUrl(baseUrl)}/login?redirect=/portal`
}

/** Finds the account for an email, or creates one with a random password that only a claim link can replace. */
async function resolveAuthUser(email: string, name: string): Promise<{ userId: string; created: boolean }> {
  const { users } = createAdminClient()
  const existing = await withRetry(() => users.list([Query.equal('email', [email]), Query.limit(1)]))
  if (existing.users[0]) return { userId: existing.users[0].$id, created: false }
  const password = ID.unique() + ID.unique()
  const created = await withRetry(() => users.create(ID.unique(), email, undefined, password, name))
  return { userId: created.$id, created: true }
}

/**
 * Deletes the Auth account an invite created for an address the organizer has
 * since replaced (OPEN_QUESTIONS #28: don't keep personal data nobody uses).
 * Called only for an unclaimed nominee, whose account came from our own
 * invite with a random password nobody knows. Still, it is deleted only when
 * nothing else uses it: no other nominee row, no workspace membership and no
 * user profile (the address may have signed up as an organizer since).
 * Best effort: a failure is logged and leaves the account in place.
 */
export async function releaseInviteAccount(userId: string): Promise<boolean> {
  const { databases, users } = createAdminClient()
  try {
    const [nominees, memberships, profiles] = await Promise.all([
      withRetry(() =>
        databases.listDocuments(databaseId(), APPWRITE.TABLES.NOMINEES, [Query.equal('userId', [userId]), Query.limit(1)])
      ),
      withRetry(() =>
        databases.listDocuments(databaseId(), APPWRITE.TABLES.MEMBERSHIPS, [
          Query.equal('userId', [userId]),
          Query.limit(1),
        ])
      ),
      withRetry(() =>
        databases.listDocuments(databaseId(), APPWRITE.TABLES.USERS, [Query.equal('$id', [userId]), Query.limit(1)])
      ),
    ])
    if (nominees.documents.length || memberships.documents.length || profiles.documents.length) return false
    await withRetry(() => users.delete(userId))
    return true
  } catch (err) {
    console.warn(`[nominee] could not release invite account ${userId}:`, err)
    return false
  }
}

export interface InviteOutcome {
  nominee: NomineeDoc
  /** `claim`: a link to set a password. `existing`: the email already had an account, which is now linked. */
  mode: 'claim' | 'existing'
  emailSent: boolean
  emailProvider: string
  /** Only for `claim` when the email was not sent, so the organizer can deliver it another way. */
  claimUrl: string | null
}

export async function inviteNominee(
  ctx: TenantContext,
  nomineeId: string,
  opts: { email?: EmailProvider; baseUrl?: string; expectedEventId?: string } = {}
): Promise<InviteOutcome> {
  assertCanManage(ctx)
  const nominee = await getTenantDocument<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, nomineeId)
  if (opts.expectedEventId && nominee.eventId !== opts.expectedEventId) throw new InviteError('wrongEvent')
  if (!nominee.email) throw new InviteError('noEmail')
  if (nominee.claimedAt) throw new InviteError('alreadyClaimed')
  const event = await getTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, nominee.eventId)
  if (event.status === 'closed') throw new InviteError('eventClosed')
  const organization = await getOrganization(ctx.organizationId)
  const provider = opts.email ?? getEmailProvider()
  const common = {
    to: nominee.email,
    nomineeName: nominee.name,
    eventTitle: event.title,
    organizationName: organization?.name ?? '',
    signInUrl: signInUrl(opts.baseUrl),
  }

  // A row with no account yet: find or create one. A row that already has an
  // account came from an earlier invite we created (an existing account would
  // have been marked claimed), so it may be re-invited with a fresh link.
  let userId = nominee.userId
  let created = userId !== null
  if (!userId) {
    const resolved = await resolveAuthUser(nominee.email, nominee.name)
    userId = resolved.userId
    created = resolved.created
  }

  if (!created) {
    const result = await provider.sendNomineeInvite({ ...common, mode: 'existing', claimUrl: null })
    const now = new Date().toISOString()
    const updated = await updateTenantDocument<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, nomineeId, {
      userId,
      claimedAt: now,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      inviteSentAt: result.sent ? now : nominee.inviteSentAt,
    })
    await writeAuditLog({
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      action: 'nominee.invite',
      target: `nominees/${nomineeId}`,
      metadata: { mode: 'existing', emailSent: result.sent, provider: result.provider },
    })
    return {
      nominee: updated,
      mode: 'existing',
      emailSent: result.sent,
      emailProvider: result.provider,
      claimUrl: null,
    }
  }

  const { token, hash, expiresAt } = generateInviteToken()
  const url = claimUrl(token, opts.baseUrl)
  const result = await provider.sendNomineeInvite({ ...common, mode: 'claim', claimUrl: url })

  const updated = await updateTenantDocument<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, nomineeId, {
    userId,
    inviteTokenHash: hash,
    inviteExpiresAt: expiresAt,
    inviteSentAt: result.sent ? new Date().toISOString() : nominee.inviteSentAt,
  })
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'nominee.invite',
    target: `nominees/${nomineeId}`,
    metadata: { mode: 'claim', emailSent: result.sent, provider: result.provider },
  })

  return {
    nominee: updated,
    mode: 'claim',
    emailSent: result.sent,
    emailProvider: result.provider,
    claimUrl: result.sent ? null : url,
  }
}

/** Looks the nominee up by the token's hash; the only way in without a session. */
export async function findNomineeByInviteToken(token: string): Promise<NomineeDoc | null> {
  if (!token || token.length < 16) return null
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<NomineeDoc>(databaseId(), APPWRITE.TABLES.NOMINEES, [
      Query.equal('inviteTokenHash', [hashInviteToken(token)]),
      Query.limit(1),
    ])
  )
  return res.documents[0] ?? null
}

/**
 * Sets the nominee's password from a valid claim link and burns the token.
 * Only accounts the invite flow created ever carry a token, so this can never
 * reset a pre-existing account. Returns the email to sign in with.
 */
export async function claimInvite(token: string, password: string): Promise<{ email: string; nomineeId: string }> {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) throw new ClaimError('passwordTooShort')
  const nominee = await findNomineeByInviteToken(token)
  if (!nominee) throw new ClaimError('invalid')
  const check = checkInviteToken(token, nominee)
  if (check !== 'ok') throw new ClaimError(check)
  if (!nominee.userId || !nominee.email) throw new ClaimError('invalid')

  const { users, databases } = createAdminClient()
  await withRetry(() => users.updatePassword(nominee.userId as string, password))
  await withRetry(() =>
    databases.updateDocument(databaseId(), APPWRITE.TABLES.NOMINEES, nominee.$id, {
      claimedAt: new Date().toISOString(),
      inviteTokenHash: null,
      inviteExpiresAt: null,
    })
  )
  await writeAuditLog({
    actorId: nominee.userId,
    organizationId: nominee.organizationId,
    action: 'nominee.claim',
    target: `nominees/${nominee.$id}`,
  })
  return { email: nominee.email, nomineeId: nominee.$id }
}
