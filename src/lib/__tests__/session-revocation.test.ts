import { beforeEach, describe, expect, it, vi } from 'vitest'

const users = { get: vi.fn(), deleteSessions: vi.fn() }
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ users }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

const T0 = Date.parse('2026-11-12T10:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

async function load() {
  vi.resetModules()
  const revocation = await import('../session-revocation')
  const server = await import('../password-recovery-server')
  return { ...revocation, ...server }
}

beforeEach(() => {
  users.get.mockReset()
  users.deleteSessions.mockReset().mockResolvedValue({})
})

describe('issuedBeforePasswordChange', () => {
  it('compares the issue time with the last password change', async () => {
    const { issuedBeforePasswordChange } = await load()
    expect(issuedBeforePasswordChange(T0, iso(T0 + 1))).toBe(true)
    expect(issuedBeforePasswordChange(T0, iso(T0))).toBe(false)
    expect(issuedBeforePasswordChange(T0, iso(T0 - 1))).toBe(false)
  })

  it('ignores a missing or unreadable stamp', async () => {
    const { issuedBeforePasswordChange } = await load()
    expect(issuedBeforePasswordChange(T0, undefined)).toBe(false)
    expect(issuedBeforePasswordChange(T0, '')).toBe(false)
    expect(issuedBeforePasswordChange(T0, 'not a date')).toBe(false)
  })
})

describe('isSessionCurrent', () => {
  it('honours a cookie issued after the last password change', async () => {
    const { isSessionCurrent } = await load()
    users.get.mockResolvedValue({ $id: 'u1', passwordUpdate: iso(T0 - 60_000) })
    expect(await isSessionCurrent('u1', T0, T0)).toBe(true)
  })

  it('refuses a cookie issued before it', async () => {
    const { isSessionCurrent } = await load()
    users.get.mockResolvedValue({ $id: 'u1', passwordUpdate: iso(T0 + 1_000) })
    expect(await isSessionCurrent('u1', T0, T0 + 2_000)).toBe(false)
  })

  it('refuses a deleted account and fails closed on other faults', async () => {
    const { isSessionCurrent } = await load()
    users.get.mockRejectedValueOnce({ code: 404, type: 'user_not_found' })
    expect(await isSessionCurrent('gone', T0, T0)).toBe(false)
    users.get.mockRejectedValueOnce(new Error('appwrite down'))
    expect(await isSessionCurrent('u2', T0, T0)).toBe(false)
    // The fault is not cached: the next request asks again.
    users.get.mockResolvedValueOnce({ $id: 'u2', passwordUpdate: iso(T0 - 1) })
    expect(await isSessionCurrent('u2', T0, T0)).toBe(true)
  })

  it('caches the stamp per instance for a minute', async () => {
    const { isSessionCurrent, STAMP_TTL_MS } = await load()
    users.get.mockResolvedValue({ $id: 'u1', passwordUpdate: iso(T0 - 1) })
    await isSessionCurrent('u1', T0, T0)
    await isSessionCurrent('u1', T0, T0 + STAMP_TTL_MS - 1)
    expect(users.get).toHaveBeenCalledTimes(1)
    await isSessionCurrent('u1', T0, T0 + STAMP_TTL_MS)
    expect(users.get).toHaveBeenCalledTimes(2)
  })
})

describe('resetPasswordWithRecovery', () => {
  const input = { userId: 'u1', secret: 's3cret', password: 'new-password-1' }

  it('changes the password, deletes every session and refuses older cookies at once', async () => {
    const { isSessionCurrent, resetPasswordWithRecovery } = await load()
    // A cookie from before the reset is honoured and its stamp cached.
    users.get.mockResolvedValue({ $id: 'u1', passwordUpdate: iso(T0 - 60_000) })
    expect(await isSessionCurrent('u1', T0, T0)).toBe(true)

    const updateRecovery = vi.fn().mockImplementation(async () => {
      users.get.mockResolvedValue({ $id: 'u1', passwordUpdate: iso(T0 + 5_000) })
    })
    const result = await resetPasswordWithRecovery(input, { account: { updateRecovery } as never })

    expect(result).toEqual({ ok: true, sessionsCleared: true })
    expect(updateRecovery).toHaveBeenCalledWith('u1', 's3cret', 'new-password-1')
    expect(users.deleteSessions).toHaveBeenCalledWith('u1')
    // Same instance, inside the cache window: the old cookie is refused anyway.
    expect(await isSessionCurrent('u1', T0, T0 + 6_000)).toBe(false)
    // A cookie issued after the reset works.
    expect(await isSessionCurrent('u1', T0 + 10_000, T0 + 10_000)).toBe(true)
  })

  it('still succeeds when deleting sessions fails, and says so', async () => {
    const { resetPasswordWithRecovery } = await load()
    users.deleteSessions.mockRejectedValue(new Error('appwrite down'))
    const updateRecovery = vi.fn().mockResolvedValue({})
    const result = await resetPasswordWithRecovery(input, { account: { updateRecovery } as never })
    expect(result).toEqual({ ok: true, sessionsCleared: false })
  })

  it('touches no sessions when Appwrite refuses the link', async () => {
    const { resetPasswordWithRecovery } = await load()
    const updateRecovery = vi.fn().mockRejectedValue({ code: 401, type: 'user_invalid_token' })
    const result = await resetPasswordWithRecovery(input, { account: { updateRecovery } as never })
    expect(result).toEqual({ ok: false, problem: 'recoveryLinkInvalid' })
    expect(users.deleteSessions).not.toHaveBeenCalled()
  })

  it('rejects a short password before calling Appwrite', async () => {
    const { resetPasswordWithRecovery } = await load()
    const updateRecovery = vi.fn()
    const result = await resetPasswordWithRecovery(
      { ...input, password: 'short' },
      { account: { updateRecovery } as never }
    )
    expect(result).toEqual({ ok: false, problem: 'passwordRejected' })
    expect(updateRecovery).not.toHaveBeenCalled()
  })

  it('reads only a well-formed body', async () => {
    const { readResetInput } = await load()
    expect(readResetInput({ userId: ' u1 ', secret: 's', password: 'p' })).toEqual({
      userId: 'u1',
      secret: 's',
      password: 'p',
    })
    expect(readResetInput(null)).toBeNull()
    expect(readResetInput({ userId: 'u1', secret: 's' })).toBeNull()
    expect(readResetInput({ userId: '', secret: 's', password: 'p' })).toBeNull()
    expect(readResetInput({ userId: 'x'.repeat(65), secret: 's', password: 'p' })).toBeNull()
  })
})
