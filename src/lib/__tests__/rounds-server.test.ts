import { beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import { TenantMismatchError, type TenantContext } from '../db'
import { createEvent } from '../events-server'
import {
  RoundError,
  assertRoundAcceptsWrites,
  canTransitionRound,
  closeRound,
  createRound,
  findLiveRound,
  listRounds,
  openRound,
} from '../rounds-server'
import { ForbiddenError } from '../tenant'

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const staff: TenantContext = { organizationId: 'org1', userId: 'u2', role: 'staff' }
const otherOrg: TenantContext = { organizationId: 'org2', userId: 'u3', role: 'owner' }

const input = {
  title: 'Miss Social Science',
  votePriceCedis: '0.50',
  startsAt: '2026-11-01T00:00:00Z',
  endsAt: '2026-11-30T00:00:00Z',
  resultsVisibility: 'hidden',
}

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  fake = createFakeDatabases(UNIQUE_INDEXES)
})

describe('round state machine (rule 3b)', () => {
  test('pending → live → closed, closed is terminal', () => {
    expect(canTransitionRound('pending', 'live')).toBe(true)
    expect(canTransitionRound('live', 'closed')).toBe(true)
    expect(canTransitionRound('pending', 'closed')).toBe(false)
    expect(canTransitionRound('closed', 'live')).toBe(false)
    expect(canTransitionRound('closed', 'pending')).toBe(false)
  })

  test('assertRoundAcceptsWrites rejects a closed round', () => {
    expect(() => assertRoundAcceptsWrites({ status: 'closed' })).toThrow(RoundError)
    expect(() => assertRoundAcceptsWrites({ status: 'live' })).not.toThrow()
  })
})

describe('createRound', () => {
  test('numbers rounds sequentially and defaults the name', async () => {
    const { event } = await createEvent(owner, input)
    const r2 = await createRound(owner, event.$id)
    const r3 = await createRound(owner, event.$id, '  Grand Finale ')
    expect(r2.number).toBe(2)
    expect(r2.name).toBe('Round 2')
    expect(r3.number).toBe(3)
    expect(r3.name).toBe('Grand Finale')
    expect(r3.organizationId).toBe('org1')
    expect((await listRounds(owner, event.$id)).map((r) => r.number)).toEqual([1, 2, 3])
  })

  test('refuses staff, other tenants and closed events', async () => {
    const { event } = await createEvent(owner, input)
    await expect(createRound(staff, event.$id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createRound(otherOrg, event.$id)).rejects.toBeInstanceOf(TenantMismatchError)
    await fake.updateDocument('voteapp', 'events', event.$id, { status: 'closed' })
    await expect(createRound(owner, event.$id)).rejects.toThrow(/eventClosed/)
  })
})

describe('open and close', () => {
  test('only one live round per event', async () => {
    const { event, round: r1 } = await createEvent(owner, input)
    const r2 = await createRound(owner, event.$id)
    await openRound(owner, r1.$id)
    await expect(openRound(owner, r2.$id)).rejects.toThrow(/anotherRoundLive/)
    expect((await findLiveRound(owner, event.$id))?.$id).toBe(r1.$id)

    await closeRound(owner, r1.$id)
    await expect(openRound(owner, r2.$id)).resolves.toMatchObject({ status: 'live' })
  })

  test('a closed round cannot be reopened or closed again', async () => {
    const { round } = await createEvent(owner, input)
    await openRound(owner, round.$id)
    const closed = await closeRound(owner, round.$id)
    expect(closed.closedAt).toBeTruthy()
    await expect(openRound(owner, round.$id)).rejects.toThrow(/badTransition/)
    await expect(closeRound(owner, round.$id)).rejects.toThrow(/badTransition/)
  })

  test('a pending round in a closed event cannot be opened', async () => {
    const { event, round: r1 } = await createEvent(owner, input)
    const r2 = await createRound(owner, event.$id)
    await openRound(owner, r1.$id)
    await closeRound(owner, r1.$id)
    await fake.updateDocument('voteapp', 'events', event.$id, { status: 'closed' })
    await expect(openRound(owner, r2.$id)).rejects.toThrow(/eventClosed/)
    expect((await fake.getDocument('voteapp', 'rounds', r2.$id)).status).toBe('pending')
  })

  test('writes audit rows for open and close', async () => {
    const { round } = await createEvent(owner, input)
    await openRound(owner, round.$id)
    await closeRound(owner, round.$id)
    const logs = fake.dump('audit_logs')
    expect(logs.map((l) => l.action)).toEqual(['round.open', 'round.close'])
    expect(logs[1]).toMatchObject({ actorId: 'u1', organizationId: 'org1', target: `rounds/${round.$id}` })
  })

  test('other tenants and staff cannot touch rounds', async () => {
    const { round } = await createEvent(owner, input)
    await expect(openRound(otherOrg, round.$id)).rejects.toBeInstanceOf(TenantMismatchError)
    await expect(openRound(staff, round.$id)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
