import { beforeEach, describe, expect, test, vi } from 'vitest'

const createDocument = vi.fn()
const deleteDocument = vi.fn()
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: { createDocument, deleteDocument } }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

const getOrganizationBySlug = vi.fn()
vi.mock('../db', () => ({
  databaseId: () => 'voteapp',
  getOrganizationBySlug: (slug: string) => getOrganizationBySlug(slug),
}))

import {
  CreateOrganizationError,
  createOrganizationWithOwner,
  normalizeCreateOrganizationInput,
} from '../organizations-server'

beforeEach(() => {
  createDocument.mockReset()
  deleteDocument.mockReset()
  getOrganizationBySlug.mockReset()
  getOrganizationBySlug.mockResolvedValue(null)
})

describe('normalizeCreateOrganizationInput', () => {
  test('trims the name and derives the slug', () => {
    expect(normalizeCreateOrganizationInput({ name: '  Unity   Hall ' })).toEqual({
      name: 'Unity Hall',
      slug: 'unity-hall',
    })
  })

  test('uses an explicit slug, lowercased', () => {
    expect(normalizeCreateOrganizationInput({ name: 'Unity Hall', slug: 'Unity-JCR' })).toEqual({
      name: 'Unity Hall',
      slug: 'unity-jcr',
    })
  })

  test('rejects bad names and slugs with a named problem', () => {
    expect(() => normalizeCreateOrganizationInput({ name: 'A' })).toThrow(CreateOrganizationError)
    expect(() => normalizeCreateOrganizationInput({ name: 'x'.repeat(121) })).toThrow(/nameTooLong/)
    expect(() => normalizeCreateOrganizationInput({ name: 'Unity Hall', slug: 'admin' })).toThrow(/slug.reserved/)
    expect(() => normalizeCreateOrganizationInput({ name: 'Unity Hall', slug: 'a b' })).toThrow(/slug.invalid/)
    expect(() => normalizeCreateOrganizationInput({ name: '!!!' })).toThrow(/slug.tooShort/)
  })
})

describe('createOrganizationWithOwner', () => {
  test('creates the organization as active and the caller as owner', async () => {
    createDocument
      .mockResolvedValueOnce({ $id: 'org1', name: 'Unity Hall', slug: 'unity-hall', status: 'active' })
      .mockResolvedValueOnce({ $id: 'm1', userId: 'u1', organizationId: 'org1', role: 'owner' })

    const result = await createOrganizationWithOwner('u1', { name: 'Unity Hall' })

    expect(result.organization.$id).toBe('org1')
    expect(result.membership.role).toBe('owner')
    const [, orgTable, , orgData] = createDocument.mock.calls[0]
    expect(orgTable).toBe('organizations')
    expect(orgData).toMatchObject({ name: 'Unity Hall', slug: 'unity-hall', status: 'active', commissionRate: null })
    const [, memTable, , memData] = createDocument.mock.calls[1]
    expect(memTable).toBe('memberships')
    expect(memData).toEqual({ userId: 'u1', organizationId: 'org1', role: 'owner' })
    expect(deleteDocument).not.toHaveBeenCalled()
  })

  test('refuses a slug that already exists', async () => {
    getOrganizationBySlug.mockResolvedValue({ $id: 'other' })
    await expect(createOrganizationWithOwner('u1', { name: 'Unity Hall' })).rejects.toThrow(/slugTaken/)
    expect(createDocument).not.toHaveBeenCalled()
  })

  test('maps a unique-index conflict on insert to slugTaken', async () => {
    createDocument.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 409 }))
    await expect(createOrganizationWithOwner('u1', { name: 'Unity Hall' })).rejects.toThrow(/slugTaken/)
  })

  test('deletes the organization when the owner membership cannot be written', async () => {
    createDocument.mockResolvedValueOnce({ $id: 'org1' }).mockRejectedValueOnce(new Error('boom'))
    deleteDocument.mockResolvedValue(undefined)
    await expect(createOrganizationWithOwner('u1', { name: 'Unity Hall' })).rejects.toThrow('boom')
    expect(deleteDocument).toHaveBeenCalledWith('voteapp', 'organizations', 'org1')
  })

  test('requires the owner id', async () => {
    await expect(createOrganizationWithOwner('', { name: 'Unity Hall' })).rejects.toThrow(/ownerUserId/)
  })
})
