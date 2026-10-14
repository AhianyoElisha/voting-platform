import { beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import type { TenantContext } from '../db'
import { TenantMismatchError } from '../db'
import {
  canTransitionEvent,
  createEvent,
  getEvent,
  listEvents,
  normalizeEventInput,
  setEventStatus,
} from '../events-server'
import { ForbiddenError } from '../tenant'

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const staff: TenantContext = { organizationId: 'org1', userId: 'u2', role: 'staff' }
const otherOrg: TenantContext = { organizationId: 'org2', userId: 'u3', role: 'owner' }

const input = {
  title: 'Faculty Awards 2026',
  votePriceCedis: '1.00',
  startsAt: '2026-11-01T00:00:00Z',
  endsAt: '2026-11-30T00:00:00Z',
  resultsVisibility: 'ranking',
}

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  fake = createFakeDatabases(UNIQUE_INDEXES)
})

describe('normalizeEventInput', () => {
  test('converts cedis to pesewas once and derives the slug', () => {
    const data = normalizeEventInput(input)
    expect(data.votePrice).toBe(100)
    expect(data.slug).toBe('faculty-awards-2026')
    expect(data.moraleCandidatesEnabled).toBe(false)
  })

  test('accepts integer pesewas from API callers and rejects floats', () => {
    expect(normalizeEventInput({ ...input, votePrice: 150 }).votePrice).toBe(150)
    expect(() => normalizeEventInput({ ...input, votePrice: 1.5 })).toThrow(/priceInvalid/)
    expect(() => normalizeEventInput({ ...input, votePrice: 0 })).toThrow(/priceZero/)
    expect(() => normalizeEventInput({ ...input, votePriceCedis: '0.005' })).toThrow(/priceInvalid/)
  })

  test('rejects bad dates, titles and visibility', () => {
    expect(() => normalizeEventInput({ ...input, endsAt: input.startsAt })).toThrow(/datesInvalid/)
    expect(() => normalizeEventInput({ ...input, title: 'A' })).toThrow(/titleTooShort/)
    expect(() => normalizeEventInput({ ...input, resultsVisibility: 'everything' })).toThrow(/visibilityInvalid/)
    expect(() => normalizeEventInput({ ...input, slug: 'admin' })).toThrow(/slugInvalid/)
  })
})

describe('createEvent', () => {
  test('creates the event as draft with round 1 pending, scoped to the tenant', async () => {
    const { event, round } = await createEvent(owner, input)
    expect(event.organizationId).toBe('org1')
    expect(event.status).toBe('draft')
    expect(event.votePrice).toBe(100)
    expect(round.eventId).toBe(event.$id)
    expect(round.number).toBe(1)
    expect(round.status).toBe('pending')
    expect(round.organizationId).toBe('org1')
  })

  test('refuses non-managers', async () => {
    await expect(createEvent(staff, input)).rejects.toBeInstanceOf(ForbiddenError)
    expect(fake.dump('events')).toHaveLength(0)
  })

  test('slug is unique within the organization only', async () => {
    await createEvent(owner, input)
    await expect(createEvent(owner, input)).rejects.toThrow(/slugTaken/)
    await expect(createEvent(otherOrg, input)).resolves.toBeTruthy()
  })

  test('rolls back the event when round 1 cannot be created', async () => {
    const original = fake.createDocument.getMockImplementation()!
    fake.createDocument.mockImplementationOnce(original).mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    await expect(createEvent(owner, input)).rejects.toThrow('boom')
    expect(fake.dump('events')).toHaveLength(0)
  })
})

describe('tenant scoping', () => {
  test('another organization cannot see or fetch the event', async () => {
    const { event } = await createEvent(owner, input)
    await expect(listEvents(otherOrg)).resolves.toHaveLength(0)
    await expect(getEvent(otherOrg, event.$id)).rejects.toBeInstanceOf(TenantMismatchError)
    await expect(setEventStatus(otherOrg, event.$id, 'live')).rejects.toBeInstanceOf(TenantMismatchError)
  })
})

describe('event status machine', () => {
  test('transition table', () => {
    expect(canTransitionEvent('draft', 'live')).toBe(true)
    expect(canTransitionEvent('live', 'paused')).toBe(true)
    expect(canTransitionEvent('paused', 'closed')).toBe(true)
    expect(canTransitionEvent('closed', 'live')).toBe(false)
    expect(canTransitionEvent('draft', 'closed')).toBe(false)
  })

  test('going live opens round 1, closing closes it and writes audit rows', async () => {
    const { event, round } = await createEvent(owner, input)
    await setEventStatus(owner, event.$id, 'live')
    expect((await fake.getDocument('voteapp', 'rounds', round.$id)).status).toBe('live')

    await setEventStatus(owner, event.$id, 'paused')
    expect((await fake.getDocument('voteapp', 'rounds', round.$id)).status).toBe('live')

    await setEventStatus(owner, event.$id, 'closed')
    const closed = await fake.getDocument('voteapp', 'rounds', round.$id)
    expect(closed.status).toBe('closed')
    expect(closed.closedAt).toBeTruthy()

    const actions = fake.dump('audit_logs').map((r) => r.action)
    expect(actions).toEqual(['round.open', 'event.live', 'event.paused', 'round.close', 'event.closed'])
    await expect(setEventStatus(owner, event.$id, 'live')).rejects.toThrow(/badTransition/)
  })

  test('refuses to go live when every round is closed and none is pending', async () => {
    const { event, round } = await createEvent(owner, input)
    await setEventStatus(owner, event.$id, 'live')
    await setEventStatus(owner, event.$id, 'paused')
    // Close round 1 by hand, leaving the paused event with no round to vote in.
    await fake.updateDocument('voteapp', 'rounds', round.$id, { status: 'closed' })
    await expect(setEventStatus(owner, event.$id, 'live')).rejects.toThrow(/noRoundToOpen/)
    expect((await fake.getDocument('voteapp', 'events', event.$id)).status).toBe('paused')
  })

  test('staff cannot change status', async () => {
    const { event } = await createEvent(owner, input)
    await expect(setEventStatus(staff, event.$id, 'live')).rejects.toBeInstanceOf(ForbiddenError)
  })
})
