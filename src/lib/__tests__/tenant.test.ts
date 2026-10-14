import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Tenant context (CLAUDE.md rule 4): an organization id is only honoured once
 * the caller's Membership in it has been found. Nothing here trusts the id on
 * its own.
 */
const findMembership = vi.fn()
vi.mock('../db', () => ({ findMembership: (...args: unknown[]) => findMembership(...args) }))

const getSessionUserId = vi.fn()
vi.mock('../auth-session', () => ({ getSessionUserId: () => getSessionUserId() }))

import { NotAMemberError, getTenantContext, requireTenantContext } from '../tenant'

beforeEach(() => {
  findMembership.mockReset()
  getSessionUserId.mockReset()
})

describe('getTenantContext', () => {
  test('returns the context with the membership role', async () => {
    findMembership.mockResolvedValue({ $id: 'm1', userId: 'u1', organizationId: 'org1', role: 'owner' })
    await expect(getTenantContext('u1', 'org1')).resolves.toEqual({
      userId: 'u1',
      organizationId: 'org1',
      role: 'owner',
    })
    expect(findMembership).toHaveBeenCalledWith('u1', 'org1')
  })

  test('refuses a user without membership in that organization', async () => {
    findMembership.mockResolvedValue(null)
    await expect(getTenantContext('u1', 'org2')).rejects.toBeInstanceOf(NotAMemberError)
  })

  test('refuses empty ids without touching the database', async () => {
    await expect(getTenantContext('', 'org1')).rejects.toBeInstanceOf(NotAMemberError)
    await expect(getTenantContext('u1', '')).rejects.toBeInstanceOf(NotAMemberError)
    expect(findMembership).not.toHaveBeenCalled()
  })
})

describe('requireTenantContext', () => {
  test('is null without a session', async () => {
    getSessionUserId.mockResolvedValue(null)
    await expect(requireTenantContext('org1')).resolves.toBeNull()
    expect(findMembership).not.toHaveBeenCalled()
  })

  test('resolves the session user and checks membership', async () => {
    getSessionUserId.mockResolvedValue('u9')
    findMembership.mockResolvedValue({ $id: 'm1', userId: 'u9', organizationId: 'org1', role: 'staff' })
    await expect(requireTenantContext('org1')).resolves.toEqual({ userId: 'u9', organizationId: 'org1', role: 'staff' })
  })

  test('throws when the session user is not a member', async () => {
    getSessionUserId.mockResolvedValue('u9')
    findMembership.mockResolvedValue(null)
    await expect(requireTenantContext('org1')).rejects.toBeInstanceOf(NotAMemberError)
  })
})
