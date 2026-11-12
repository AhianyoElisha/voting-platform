import { createAdminClient, withRetry } from './appwrite-server'

/**
 * Signs out other devices after a password change.
 *
 * Our session cookie (`session.ts`) is stateless, so it cannot be deleted from
 * other browsers. Instead a cookie is only honoured if it was issued after the
 * user's last password change, which Appwrite records on the Auth user as
 * `passwordUpdate` (set by password recovery and by `users.updatePassword`).
 * The reset itself also deletes the user's Appwrite sessions, so no old
 * browser session can mint a fresh cookie through `/api/auth/init-session`.
 *
 * The stamp is cached per server instance for `STAMP_TTL_MS`, so a revoked
 * cookie can keep working on a warm instance for up to that long.
 */

export const STAMP_TTL_MS = 60_000
const MAX_CACHED = 5_000

type Stamp = { passwordUpdate: number | null; exists: boolean; fetchedAt: number }
const cache = new Map<string, Stamp>()

/** True when a cookie or session created at `issuedAt` predates the last password change. */
export function issuedBeforePasswordChange(
  issuedAt: number,
  passwordUpdate: string | number | null | undefined
): boolean {
  if (passwordUpdate === null || passwordUpdate === undefined || passwordUpdate === '') return false
  const changedAt = typeof passwordUpdate === 'number' ? passwordUpdate : Date.parse(passwordUpdate)
  if (!Number.isFinite(changedAt)) return false
  return issuedAt < changedAt
}

async function loadStamp(userId: string, now: number): Promise<Stamp> {
  const cached = cache.get(userId)
  if (cached && now - cached.fetchedAt < STAMP_TTL_MS) return cached
  let stamp: Stamp
  try {
    const { users } = createAdminClient()
    const user = await withRetry(() => users.get(userId))
    const at = user.passwordUpdate ? Date.parse(user.passwordUpdate) : NaN
    stamp = { passwordUpdate: Number.isFinite(at) ? at : null, exists: true, fetchedAt: now }
  } catch (err) {
    const code = typeof err === 'object' && err && 'code' in err ? (err as { code?: number }).code : undefined
    // A deleted account signs out. Any other fault fails closed and is not cached.
    if (code === 404) stamp = { passwordUpdate: null, exists: false, fetchedAt: now }
    else {
      console.warn('[session-revocation] could not load the user; treating the session as invalid', code)
      return { passwordUpdate: null, exists: false, fetchedAt: now }
    }
  }
  if (cache.size >= MAX_CACHED) cache.clear()
  cache.set(userId, stamp)
  return stamp
}

/** Whether a cookie issued at `issuedAt` for `userId` is still honoured. */
export async function isSessionCurrent(userId: string, issuedAt: number, now: number = Date.now()): Promise<boolean> {
  const stamp = await loadStamp(userId, now)
  if (!stamp.exists) return false
  return !issuedBeforePasswordChange(issuedAt, stamp.passwordUpdate)
}

/** Drop the cached stamp after a password change on this instance. */
export function forgetPasswordStamp(userId: string): void {
  cache.delete(userId)
}
