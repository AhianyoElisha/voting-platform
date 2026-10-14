import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The signed session cookie (src/lib/session.ts), same scheme as pickLT:
 * `userId:timestamp:hmac`, HMAC-SHA256 over `userId:timestamp` with
 * SESSION_SECRET, 30-day expiry, constant-time compare.
 */
describe('session cookie', () => {
  const secret = 'a'.repeat(64)

  beforeEach(() => {
    vi.resetModules()
    process.env.SESSION_SECRET = secret
    delete process.env.APPWRITE_API_KEY
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function load() {
    return await import('../session')
  }

  test('round-trips a user id', async () => {
    const { signSessionCookie, verifySessionCookie } = await load()
    const cookie = signSessionCookie('user_123')
    expect(cookie.split(':')).toHaveLength(3)
    expect(verifySessionCookie(cookie)).toBe('user_123')
  })

  test('rejects a tampered user id', async () => {
    const { signSessionCookie, verifySessionCookie } = await load()
    const [, ts, sig] = signSessionCookie('user_123').split(':')
    expect(verifySessionCookie(`user_456:${ts}:${sig}`)).toBeNull()
  })

  test('rejects a cookie signed with another secret', async () => {
    const { signSessionCookie } = await load()
    const cookie = signSessionCookie('user_123')
    vi.resetModules()
    process.env.SESSION_SECRET = 'b'.repeat(64)
    const { verifySessionCookie } = await load()
    expect(verifySessionCookie(cookie)).toBeNull()
  })

  test('rejects malformed values', async () => {
    const { verifySessionCookie } = await load()
    expect(verifySessionCookie('')).toBeNull()
    expect(verifySessionCookie('user_123')).toBeNull()
    expect(verifySessionCookie('a:b:c:d')).toBeNull()
    expect(verifySessionCookie('user_123:123:nothex')).toBeNull()
  })

  test('expires after MAX_AGE', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-14T00:00:00Z'))
    const { signSessionCookie, verifySessionCookie, MAX_AGE } = await load()
    const cookie = signSessionCookie('user_123')
    vi.setSystemTime(new Date(Date.now() + (MAX_AGE - 60) * 1000))
    expect(verifySessionCookie(cookie)).toBe('user_123')
    vi.setSystemTime(new Date(Date.now() + 120 * 1000))
    expect(verifySessionCookie(cookie)).toBeNull()
  })

  test('refuses to run without a secret, or with the Appwrite API key as the secret', async () => {
    delete process.env.SESSION_SECRET
    let mod = await load()
    expect(() => mod.signSessionCookie('user_123')).toThrow(/SESSION_SECRET/)

    vi.resetModules()
    process.env.SESSION_SECRET = secret
    process.env.APPWRITE_API_KEY = secret
    mod = await load()
    expect(() => mod.signSessionCookie('user_123')).toThrow(/must not be the same/)
  })
})
