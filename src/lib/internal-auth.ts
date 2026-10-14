import crypto from 'crypto'

/**
 * Who may call internal job routes. Two callers exist:
 * - Vercel cron, which sends `Authorization: Bearer <CRON_SECRET>` on a GET.
 * - Anything we trigger by hand or from another scheduler, which sends
 *   `x-internal-secret: <INTERNAL_JOB_SECRET>`.
 * Either secret alone is enough. With neither configured, nothing is.
 */
export function isAuthorizedJobRequest(
  headers: Headers,
  env: Record<string, string | undefined> = process.env
): boolean {
  const auth = headers.get('authorization') ?? ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (env.CRON_SECRET && safeEqual(bearer, env.CRON_SECRET)) return true
  const internal = headers.get('x-internal-secret') ?? ''
  if (env.INTERNAL_JOB_SECRET && safeEqual(internal, env.INTERNAL_JOB_SECRET)) return true
  return false
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
