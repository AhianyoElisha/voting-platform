/**
 * Password recovery through Appwrite Auth, run from the browser SDK like
 * sign-in (ARCHITECTURE: the browser SDK is used for Auth only).
 *
 * 1. `/forgot-password` calls `account.createRecovery(email, url)`. Appwrite
 *    emails a link to `url?userId=…&secret=…&expire=…` (its own mailer, or
 *    custom SMTP set in the Appwrite console). The link is valid for one hour.
 * 2. `/reset-password` reads those parameters and calls
 *    `account.updateRecovery(userId, secret, password)`.
 *
 * Appwrite answers 404 for an email with no account. The page shows the same
 * "check your inbox" message either way, so the form cannot be used to find
 * out who has an account.
 */

export const RESET_PASSWORD_PATH = '/reset-password'
export const MIN_PASSWORD_LENGTH = 8

/** Where the emailed link points. Appwrite only accepts hosts registered as web platforms in the project. */
export function recoveryUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${RESET_PASSWORD_PATH}`
}

export type RecoveryParams = { userId: string; secret: string; expired: boolean }

type ParamSource = { get(name: string): string | null }

/**
 * The parameters Appwrite appends to the link, or null when the link is
 * incomplete. `expired` comes from Appwrite's `expire` timestamp and only lets
 * the page say so up front; Appwrite still checks the secret and its expiry.
 */
export function parseRecoveryParams(params: ParamSource, now: number = Date.now()): RecoveryParams | null {
  const userId = params.get('userId')?.trim() ?? ''
  const secret = params.get('secret')?.trim() ?? ''
  if (!userId || !secret) return null
  // An unencoded "+00:00" offset reads back as " 00:00" from a query string.
  const expire = params.get('expire')?.trim().replace(/ /g, '+')
  const at = expire ? Date.parse(expire) : NaN
  return { userId, secret, expired: Number.isFinite(at) && at <= now }
}

/** Translation key for a failed recovery call, under `errors:auth`. */
export type RecoveryProblem = 'rateLimited' | 'recoveryLinkInvalid' | 'passwordRejected' | 'unknown'

function errorCode(err: unknown): number | undefined {
  return typeof err === 'object' && err && 'code' in err ? (err as { code?: number }).code : undefined
}

function errorType(err: unknown): string | undefined {
  return typeof err === 'object' && err && 'type' in err ? String((err as { type?: unknown }).type) : undefined
}

/**
 * Outcome of `createRecovery`. A missing account counts as sent (no account
 * enumeration); only throttling and genuine faults are shown.
 */
export function requestOutcome(err: unknown): 'sent' | RecoveryProblem {
  if (err === undefined || err === null) return 'sent'
  const code = errorCode(err)
  if (code === 404 || errorType(err) === 'user_not_found') return 'sent'
  if (code === 429) return 'rateLimited'
  return 'unknown'
}

/** Problem shown when `updateRecovery` fails. */
export function resetProblem(err: unknown): RecoveryProblem {
  const code = errorCode(err)
  const type = errorType(err)
  if (code === 429) return 'rateLimited'
  // Wrong, used or expired secret, or a user that no longer exists.
  if (code === 401 || code === 404 || type === 'user_invalid_token' || type === 'user_not_found') {
    return 'recoveryLinkInvalid'
  }
  // Appwrite's password rules (length, and history or dictionary if switched on).
  if (code === 400) return 'passwordRejected'
  return 'unknown'
}
