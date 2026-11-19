import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import { TenantMismatchError, type TenantContext } from '../db'
import { createEvent } from '../events-server'
import { findNomineeByCode } from '../nominee-code'
import {
  canCreateMoraleCandidate,
  createCategory,
  createNominee,
  listCategories,
  listNominees,
  listRoundEntries,
} from '../nominees-server'
import { closeRound, openRound } from '../rounds-server'
import { ForbiddenError } from '../tenant'

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const admin: TenantContext = { organizationId: 'org1', userId: 'u4', role: 'admin' }
const staff: TenantContext = { organizationId: 'org1', userId: 'u2', role: 'staff' }
const otherOrg: TenantContext = { organizationId: 'org2', userId: 'u3', role: 'owner' }

const input = {
  title: 'Faculty Awards',
  votePriceCedis: '1',
  startsAt: '2026-11-01T00:00:00Z',
  endsAt: '2026-11-30T00:00:00Z',
  resultsVisibility: 'count',
}

async function seedEvent(ctx = owner, extra: Partial<typeof input> & { moraleCandidatesEnabled?: boolean } = {}) {
  const { event, round } = await createEvent(ctx, { ...input, ...extra })
  const category = await createCategory(ctx, event.$id, 'Most Influential')
  return { event, round, category }
}

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  delete process.env.MORALE_CANDIDATES_ENABLED
  fake = createFakeDatabases(UNIQUE_INDEXES)
  fake.seed('organizations', {
    $id: 'org1',
    name: 'Org 1',
    slug: 'org-1',
    status: 'active',
    moraleCandidatesEnabled: false,
  })
})

afterEach(() => {
  delete process.env.MORALE_CANDIDATES_ENABLED
})

describe('categories', () => {
  test('are ordered, tenant-scoped and manager-only', async () => {
    const { event } = await seedEvent()
    await createCategory(owner, event.$id, 'Best Dressed')
    expect((await listCategories(owner, event.$id)).map((c) => [c.name, c.order])).toEqual([
      ['Most Influential', 1],
      ['Best Dressed', 2],
    ])
    await expect(createCategory(staff, event.$id, 'X Y')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createCategory(otherOrg, event.$id, 'X Y')).rejects.toBeInstanceOf(TenantMismatchError)
    await expect(listCategories(otherOrg, event.$id)).resolves.toHaveLength(0)
  })
})

describe('createNominee', () => {
  test('assigns a platform-wide unique numeric code and a round 1 entry', async () => {
    const { event, round, category } = await seedEvent()
    const { nominee, entry } = await createNominee(owner, {
      eventId: event.$id,
      categoryId: category.$id,
      name: 'Ama Owusu',
    })
    expect(nominee.code).toMatch(/^[1-9][0-9]{3,7}$/)
    expect(nominee.isMorale).toBe(false)
    expect(nominee.organizationId).toBe('org1')
    expect(entry).toMatchObject({ roundId: round.$id, nomineeId: nominee.$id, voteCount: 0, organizationId: 'org1' })

    const found = await findNomineeByCode(nominee.code)
    expect(found?.$id).toBe(nominee.$id)
    expect(found?.organizationId).toBe('org1')
  })

  test('codes never collide across organizations', async () => {
    const a = await seedEvent(owner)
    fake.seed('organizations', {
      $id: 'org2',
      name: 'Org 2',
      slug: 'org-2',
      status: 'active',
      moraleCandidatesEnabled: false,
    })
    const b = await seedEvent(otherOrg)
    const codes = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const ctx = i % 2 ? owner : otherOrg
      const seed = i % 2 ? a : b
      const { nominee } = await createNominee(ctx, {
        eventId: seed.event.$id,
        categoryId: seed.category.$id,
        name: `Nominee ${i}`,
      })
      codes.add(nominee.code)
    }
    expect(codes.size).toBe(10)
  })

  test('retries when the unique index rejects a code', async () => {
    const { event, category } = await seedEvent()
    const original = fake.createDocument.getMockImplementation()!
    fake.createDocument.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Duplicate code'), { code: 409 })
    })
    fake.createDocument.mockImplementation(original)
    const { nominee } = await createNominee(owner, {
      eventId: event.$id,
      categoryId: category.$id,
      name: 'Kofi Mensah',
    })
    expect(nominee.code).toMatch(/^[1-9][0-9]{3,7}$/)
  })

  test('refuses a category from another event, staff, other tenants and closed events', async () => {
    const { event, category } = await seedEvent()
    const other = await createEvent(owner, { ...input, title: 'Other Event' })
    await expect(
      createNominee(owner, { eventId: other.event.$id, categoryId: category.$id, name: 'Ama Owusu' })
    ).rejects.toThrow(/categoryNotInEvent/)
    await expect(
      createNominee(staff, { eventId: event.$id, categoryId: category.$id, name: 'Ama' })
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      createNominee(otherOrg, { eventId: event.$id, categoryId: category.$id, name: 'Ama' })
    ).rejects.toBeInstanceOf(TenantMismatchError)
    await fake.updateDocument('voteapp', 'events', event.$id, { status: 'closed' })
    await expect(createNominee(owner, { eventId: event.$id, categoryId: category.$id, name: 'Ama' })).rejects.toThrow(
      /eventClosed/
    )
  })

  test('with every round closed a new nominee has no entry until the organizer picks them (#30)', async () => {
    const { event, round, category } = await seedEvent()
    await openRound(owner, round.$id)
    await closeRound(owner, round.$id)
    const { entry } = await createNominee(owner, { eventId: event.$id, categoryId: category.$id, name: 'Late Entry' })
    expect(entry).toBeNull()
    expect(await listRoundEntries(owner, round.$id)).toHaveLength(0)
  })

  test('other tenants cannot list the nominees', async () => {
    const { event, category } = await seedEvent()
    await createNominee(owner, { eventId: event.$id, categoryId: category.$id, name: 'Ama Owusu' })
    await expect(listNominees(owner, event.$id)).resolves.toHaveLength(1)
    await expect(listNominees(otherOrg, event.$id)).resolves.toHaveLength(0)
  })
})

describe('morale candidates (PRD 5.4a, decision #29)', () => {
  const orgRow = (enabled: boolean) => ({
    $id: 'org1',
    name: 'Org 1',
    slug: 'org-1',
    status: 'active',
    moraleCandidatesEnabled: enabled,
  })

  test('gate requires all three switches and a manager role', () => {
    const on = { platformEnabled: true, organizationEnabled: true, eventEnabled: true, role: 'admin' as const }
    expect(canCreateMoraleCandidate(on)).toBe(true)
    expect(canCreateMoraleCandidate({ ...on, platformEnabled: false })).toBe(false)
    expect(canCreateMoraleCandidate({ ...on, organizationEnabled: false })).toBe(false)
    expect(canCreateMoraleCandidate({ ...on, eventEnabled: false })).toBe(false)
    expect(canCreateMoraleCandidate({ ...on, role: 'staff' })).toBe(false)
    expect(canCreateMoraleCandidate({ ...on, role: 'designer' })).toBe(false)
  })

  test("with the defaults, the organizer's per-event opt-in is enough", async () => {
    fake.seed('organizations', orgRow(true))
    const { event, category } = await seedEvent(admin, { moraleCandidatesEnabled: true })
    const { nominee } = await createNominee(admin, {
      eventId: event.$id,
      categoryId: category.$id,
      name: 'Planted One',
      isMorale: true,
    })
    expect(nominee.isMorale).toBe(true)
    const log = fake.dump('audit_logs').find((l) => l.action === 'nominee.create_morale')
    expect(log).toMatchObject({ actorId: 'u4', organizationId: 'org1', target: `nominees/${nominee.$id}` })
  })

  test('an event that has not opted in refuses, even for the owner', async () => {
    fake.seed('organizations', orgRow(true))
    const { event, category } = await seedEvent(owner, { moraleCandidatesEnabled: false })
    await expect(
      createNominee(owner, { eventId: event.$id, categoryId: category.$id, name: 'Planted One', isMorale: true })
    ).rejects.toThrow(/moraleDisabled/)
    expect(fake.dump('nominees')).toHaveLength(0)
    expect(fake.dump('audit_logs')).toHaveLength(0)
  })

  test('the super admin can switch it off per organization or platform-wide', async () => {
    fake.seed('organizations', orgRow(false))
    const a = await seedEvent(owner, { moraleCandidatesEnabled: true })
    await expect(
      createNominee(owner, { eventId: a.event.$id, categoryId: a.category.$id, name: 'Planted One', isMorale: true })
    ).rejects.toThrow(/moraleDisabled/)

    fake.seed('organizations', orgRow(true))
    process.env.MORALE_CANDIDATES_ENABLED = 'false'
    await expect(
      createNominee(owner, { eventId: a.event.$id, categoryId: a.category.$id, name: 'Planted Two', isMorale: true })
    ).rejects.toThrow(/moraleDisabled/)
    expect(fake.dump('nominees')).toHaveLength(0)
  })
})
