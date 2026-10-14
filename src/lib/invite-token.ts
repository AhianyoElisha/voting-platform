import crypto from 'crypto'

/**
 * One-time claim tokens for nominee invites (PRD 5.2a). The token itself goes
 * in the link; only its SHA-256 hash is stored, so a database read never
 * yields a usable link. Verification is constant-time and checks expiry.
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function generateInviteToken(): { token: string; hash: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, hash: hashInviteToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString() }
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export type InviteCheck = 'ok' | 'invalid' | 'expired' | 'used'

export function checkInviteToken(
  token: string,
  stored: { inviteTokenHash: string | null; inviteExpiresAt: string | null; claimedAt: string | null },
  now = new Date()
): InviteCheck {
  if (stored.claimedAt) return 'used'
  if (!stored.inviteTokenHash || !stored.inviteExpiresAt) return 'invalid'
  if (!token || token.length < 16) return 'invalid'
  const enc = new TextEncoder()
  const a = enc.encode(hashInviteToken(token))
  const b = enc.encode(stored.inviteTokenHash)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'invalid'
  if (now > new Date(stored.inviteExpiresAt)) return 'expired'
  return 'ok'
}
