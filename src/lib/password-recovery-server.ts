import { Account, Client } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { MIN_PASSWORD_LENGTH, resetProblem, type RecoveryProblem } from './password-recovery'
import { forgetPasswordStamp } from './session-revocation'

/** Appwrite's own upper bound on passwords. */
const MAX_PASSWORD_LENGTH = 256

export type ResetInput = { userId: string; secret: string; password: string }
export type ResetResult = { ok: true; sessionsCleared: boolean } | { ok: false; problem: RecoveryProblem }

/** Guest Appwrite client: recovery is an unauthenticated call that Appwrite rate-limits per user. */
function guestAccount(): Pick<Account, 'updateRecovery'> {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  return new Account(client)
}

export function readResetInput(body: unknown): ResetInput | null {
  if (typeof body !== 'object' || body === null) return null
  const { userId, secret, password } = body as Record<string, unknown>
  if (typeof userId !== 'string' || typeof secret !== 'string' || typeof password !== 'string') return null
  const id = userId.trim()
  const s = secret.trim()
  if (!id || id.length > 64 || !s || s.length > 512) return null
  return { userId: id, secret: s, password }
}

/**
 * Set the new password from a recovery link, then sign the user out
 * everywhere: delete every Appwrite session (so no old browser can mint a new
 * cookie) and drop the cached password stamp (so old cookies are refused on
 * this instance at once; see `session-revocation.ts`).
 *
 * The password change is what matters; if deleting the sessions fails, old
 * cookies are still refused once Appwrite's `passwordUpdate` is seen, and
 * `/api/auth/init-session` refuses sessions created before the change.
 */
export async function resetPasswordWithRecovery(
  input: ResetInput,
  deps: { account?: Pick<Account, 'updateRecovery'> } = {}
): Promise<ResetResult> {
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, problem: 'passwordRejected' }
  }
  const account = deps.account ?? guestAccount()
  try {
    await account.updateRecovery(input.userId, input.secret, input.password)
  } catch (err) {
    return { ok: false, problem: resetProblem(err) }
  }

  forgetPasswordStamp(input.userId)
  let sessionsCleared = true
  try {
    const { users } = createAdminClient()
    await withRetry(() => users.deleteSessions(input.userId))
  } catch (err) {
    sessionsCleared = false
    console.error('[password-reset] password changed but sessions were not deleted', err)
  }
  return { ok: true, sessionsCleared }
}
