import { beforeEach, describe, expect, it, vi } from 'vitest'

const databases = {
  incrementDocumentAttribute: vi.fn(),
  createDocument: vi.fn(),
  deleteDocuments: vi.fn(),
}
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import {
  appwriteStore,
  pruneRateLimits,
  rateLimit,
  resetRateLimits,
  setRateLimitStore,
  windowId,
  type RateLimitStore,
} from '../rate-limit'

process.env.APPWRITE_DATABASE_ID = 'voteapp'
const T0 = Date.parse('2026-11-12T10:00:00Z')
const limitErr = { code: 400, type: 'attribute_limit_exceeded' }

/**
 * A fake of Appwrite's atomic increment with `max`, shared by "instances"
 * that each have their own per-instance counter (simulated by resetting it).
 */
function fakeAppwrite() {
  const rows = new Map<string, number>()
  databases.incrementDocumentAttribute.mockImplementation(
    async (_db: string, _t: string, id: string, _attr: string, by: number, max: number) => {
      if (!rows.has(id)) throw { code: 404, type: 'document_not_found' }
      const next = rows.get(id)! + by
      if (next > max) throw limitErr
      rows.set(id, next)
      return { count: next }
    }
  )
  databases.createDocument.mockImplementation(async (_db: string, _t: string, id: string) => {
    if (rows.has(id)) throw { code: 409, type: 'document_already_exists' }
    rows.set(id, 1)
    return { $id: id }
  })
  return rows
}

beforeEach(() => {
  resetRateLimits()
  databases.incrementDocumentAttribute.mockReset()
  databases.createDocument.mockReset()
  databases.deleteDocuments.mockReset()
})

describe('rateLimit (memory store)', () => {
  it('allows `limit` requests per window, then refuses with the time left', async () => {
    for (let i = 0; i < 3; i++) expect((await rateLimit('k', 3, 60_000, T0 + 1_000)).ok).toBe(true)
    expect(await rateLimit('k', 3, 60_000, T0 + 1_000)).toEqual({ ok: false, retryAfterMs: 59_000 })
    // Next window starts fresh.
    expect((await rateLimit('k', 3, 60_000, T0 + 60_000)).ok).toBe(true)
  })

  it('keeps keys apart', async () => {
    expect((await rateLimit('a', 1, 60_000, T0)).ok).toBe(true)
    expect((await rateLimit('b', 1, 60_000, T0)).ok).toBe(true)
    expect((await rateLimit('a', 1, 60_000, T0)).ok).toBe(false)
  })
})

describe('rateLimit (shared store)', () => {
  it('holds the limit across instances', async () => {
    fakeAppwrite()
    setRateLimitStore(appwriteStore())
    const results: boolean[] = []
    for (let i = 0; i < 5; i++) {
      // Each request lands on a different instance: no per-instance memory.
      resetRateLimits()
      setRateLimitStore(appwriteStore())
      results.push((await rateLimit('initiate:phone:233241234567', 3, 60_000, T0)).ok)
    }
    expect(results).toEqual([true, true, true, false, false])
  })

  it('stores a hash, never the key itself', async () => {
    fakeAppwrite()
    setRateLimitStore(appwriteStore())
    await rateLimit('initiate:phone:233241234567', 3, 60_000, T0)
    const [, , id, data] = databases.createDocument.mock.calls[0]
    expect(id).toBe(windowId('initiate:phone:233241234567', 60_000, T0))
    expect(id).toMatch(/^rl[0-9a-f]{32}$/)
    expect(JSON.stringify(data)).not.toContain('233241234567')
    expect(data).toEqual({ count: 1, expiresAt: new Date(T0 + 60_000).toISOString() })
  })

  it('handles two instances creating the same window at once', async () => {
    const rows = fakeAppwrite()
    const id = windowId('k', 60_000, T0)
    // The other instance creates the row between our 404 and our create.
    databases.incrementDocumentAttribute.mockImplementationOnce(async () => {
      rows.set(id, 1)
      throw { code: 404 }
    })
    setRateLimitStore(appwriteStore())
    expect((await rateLimit('k', 2, 60_000, T0)).ok).toBe(true)
    expect(rows.get(id)).toBe(2)
  })

  it('refuses without a database call once this instance has seen the limit', async () => {
    fakeAppwrite()
    setRateLimitStore(appwriteStore())
    await rateLimit('k', 1, 60_000, T0)
    databases.incrementDocumentAttribute.mockClear()
    databases.createDocument.mockClear()
    expect((await rateLimit('k', 1, 60_000, T0)).ok).toBe(false)
    expect(databases.incrementDocumentAttribute).not.toHaveBeenCalled()
  })

  it('fails open on a store fault, keeping the per-instance limit', async () => {
    const broken: RateLimitStore = { hit: vi.fn().mockRejectedValue(new Error('appwrite down')) }
    setRateLimitStore(broken)
    expect((await rateLimit('k', 1, 60_000, T0)).ok).toBe(true)
    expect((await rateLimit('k', 1, 60_000, T0)).ok).toBe(false)
  })

  it('rethrows unexpected Appwrite errors to the fail-open path', async () => {
    databases.incrementDocumentAttribute.mockRejectedValue({ code: 401, type: 'general_unauthorized_scope' })
    await expect(appwriteStore().hit('rlx', 3, T0)).rejects.toMatchObject({ code: 401 })
  })
})

describe('pruneRateLimits', () => {
  it('deletes windows that have expired', async () => {
    databases.deleteDocuments.mockResolvedValue({ total: 7, documents: [] })
    expect(await pruneRateLimits(T0)).toBe(7)
    const [, table, queries] = databases.deleteDocuments.mock.calls[0]
    expect(table).toBe('rate_limits')
    expect(queries.join(' ')).toContain('lessThan')
    expect(queries.join(' ')).toContain('2026-11-12T10:00:00.000Z')
  })
})
