import { Query } from 'node-appwrite'
import { createHash } from 'node:crypto'
import { createAdminClient, withRetry } from './appwrite-server'
import { APPWRITE } from './constants'
import { databaseId } from './db'

/**
 * Fixed-window rate limiter shared by every server instance.
 *
 * The counter lives in the `rate_limits` table and is raised with Appwrite's
 * atomic `incrementDocumentAttribute(…, max)`, which refuses to pass the
 * limit, so concurrent requests on different instances cannot overshoot it.
 * A per-instance counter runs in front: it never allows more than the shared
 * one, so a client already over the limit is turned away without a database
 * call.
 *
 * Keys are hashed before they reach the database, so phone numbers and IPs
 * are not stored (#28). Rows carry `expiresAt` and are pruned by the
 * reconciliation cron (`pruneRateLimits`).
 *
 * If Appwrite cannot be reached the limiter fails open (the per-instance
 * counter still applies): an outage of this control must not stop voting.
 *
 * The limits themselves (the numbers passed in at each call site) are still
 * placeholders for OPEN_QUESTIONS #27 (fraud controls).
 */

export type RateLimitResult = { ok: boolean; retryAfterMs: number }

/** Shared counter: `true` while the window's count stays within `limit`. */
export interface RateLimitStore {
  hit(id: string, limit: number, expiresAt: number): Promise<boolean>
}

// ─── Per-instance counter ───────────────────────────────────────

const MAX_LOCAL = 10_000
const local = new Map<string, { count: number; expiresAt: number }>()

function hitLocal(id: string, limit: number, expiresAt: number, now: number): boolean {
  let bucket = local.get(id)
  if (!bucket || bucket.expiresAt <= now) {
    if (local.size >= MAX_LOCAL) {
      for (const [k, v] of local) if (v.expiresAt <= now) local.delete(k)
      if (local.size >= MAX_LOCAL) local.clear()
    }
    bucket = { count: 0, expiresAt }
    local.set(id, bucket)
  }
  bucket.count += 1
  return bucket.count <= limit
}

/** In-memory store: tests, and `RATE_LIMIT_STORE=memory`. */
export function memoryStore(): RateLimitStore {
  const counts = new Map<string, { count: number; expiresAt: number }>()
  return {
    async hit(id, limit, expiresAt) {
      const now = Date.now()
      for (const [k, v] of counts) if (v.expiresAt <= now) counts.delete(k)
      const bucket = counts.get(id) ?? { count: 0, expiresAt }
      if (bucket.count >= limit) return false
      bucket.count += 1
      counts.set(id, bucket)
      return true
    },
  }
}

// ─── Appwrite store ─────────────────────────────────────────────

function errorCode(err: unknown): number | undefined {
  return typeof err === 'object' && err && 'code' in err ? (err as { code?: number }).code : undefined
}

function errorType(err: unknown): string {
  return typeof err === 'object' && err && 'type' in err ? String((err as { type?: unknown }).type) : ''
}

/** Appwrite's refusal to increment past `max`. */
export function isLimitExceeded(err: unknown): boolean {
  return errorCode(err) === 400 && /limit_exceeded|max/i.test(errorType(err))
}

export function appwriteStore(): RateLimitStore {
  const table = APPWRITE.TABLES.RATE_LIMITS
  return {
    async hit(id, limit, expiresAt) {
      const { databases } = createAdminClient()
      const db = databaseId()
      const increment = () => withRetry(() => databases.incrementDocumentAttribute(db, table, id, 'count', 1, limit))
      try {
        await increment()
        return true
      } catch (err) {
        if (isLimitExceeded(err)) return false
        if (errorCode(err) !== 404) throw err
      }
      // First hit in this window.
      try {
        await withRetry(() =>
          databases.createDocument(db, table, id, { count: 1, expiresAt: new Date(expiresAt).toISOString() })
        )
        return limit >= 1
      } catch (err) {
        if (errorCode(err) !== 409) throw err
      }
      // Another instance created it first.
      try {
        await increment()
        return true
      } catch (err) {
        if (isLimitExceeded(err)) return false
        throw err
      }
    },
  }
}

// ─── Store selection ────────────────────────────────────────────

let store: RateLimitStore | null = null

function currentStore(): RateLimitStore {
  if (store) return store
  const choice = process.env.RATE_LIMIT_STORE ?? (process.env.NODE_ENV === 'test' ? 'memory' : 'appwrite')
  store = choice === 'memory' ? memoryStore() : appwriteStore()
  return store
}

/** Test hook. */
export function setRateLimitStore(next: RateLimitStore | null): void {
  store = next
}

/** Window row id: a hash of the key and the window, valid as an Appwrite id (≤ 36 chars). */
export function windowId(key: string, windowMs: number, windowStart: number): string {
  return 'rl' + createHash('sha256').update(`${key}|${windowMs}|${windowStart}`).digest('hex').slice(0, 32)
}

/**
 * Count one request against `key`: at most `limit` per `windowMs`, across all
 * instances. `retryAfterMs` is the time left in the window when refused.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / windowMs) * windowMs
  const expiresAt = windowStart + windowMs
  const refused = { ok: false, retryAfterMs: expiresAt - now }
  const id = windowId(key, windowMs, windowStart)

  if (!hitLocal(id, limit, expiresAt, now)) return refused
  try {
    return (await currentStore().hit(id, limit, expiresAt)) ? { ok: true, retryAfterMs: 0 } : refused
  } catch (err) {
    console.warn('[rate-limit] shared store unavailable; per-instance limit only', errorCode(err), errorType(err))
    return { ok: true, retryAfterMs: 0 }
  }
}

/** Delete expired window rows. Called by the reconciliation cron. */
export async function pruneRateLimits(now = Date.now()): Promise<number> {
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.deleteDocuments(databaseId(), APPWRITE.TABLES.RATE_LIMITS, [
      Query.lessThan('expiresAt', new Date(now).toISOString()),
      Query.limit(1000),
    ])
  )
  return res.total
}

/** Test helper: clears the per-instance counters and the store. */
export function resetRateLimits(): void {
  local.clear()
  store = null
}

/** Client IP as Vercel reports it (it overwrites `x-forwarded-for`), or `unknown`. */
export function clientIp(headers: Headers): string {
  return headers.get('x-real-ip')?.trim() || headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}
