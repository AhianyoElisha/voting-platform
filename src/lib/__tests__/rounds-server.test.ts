import { beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import { TenantMismatchError, type TenantContext } from '../db'
import { createEvent } from '../events-server'
import { createCategory, createNominee, listRoundEntries } from '../nominees-server'
import {
  RoundError,
  assertRoundAcceptsWrites,
  canTransitionRound,
  closeRound,
  createRound,
  effectiveVotePrice,
  findLiveRound,
  listRounds,
  nextOpenRound,
  openRound,
  setRoundEntrants,
  setRoundPrice,
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

describe('who is in a round (decision #30)', () => {
  // Round 1 closed with three nominees in it, and a pending round 2.
  async function twoRounds() {
    const { event, round: one } = await createEvent(owner, input)
    const category = await createCategory(owner, event.$id, 'Most Influential')
    const nominees = []
    for (const name of ['Ama Owusu', 'Efua Asante', 'Kofi Mensah']) {
      nominees.push((await createNominee(owner, { eventId: event.$id, categoryId: category.$id, name })).nominee)
    }
    await openRound(owner, one.$id)
    await closeRound(owner, one.$id)
    const two = await createRound(owner, event.$id)
    return { event, category, one, two, nominees }
  }
  const inRound = async (roundId: string) => (await listRoundEntries(owner, roundId)).map((e) => e.nomineeId).sort()

  test('a new round starts empty and the organizer picks who is in it', async () => {
    const { event, two, nominees } = await twoRounds()
    expect(await inRound(two.$id)).toEqual([])
    const [ama, efua, kofi] = nominees.map((n) => n.$id)

    expect(await setRoundEntrants(owner, event.$id, two.$id, [ama, efua])).toEqual({ added: 2, removed: 0, total: 2 })
    expect(await inRound(two.$id)).toEqual([ama, efua].sort())
    // Picking again replaces the set: Efua out, Kofi in. Everyone starts at zero.
    expect(await setRoundEntrants(owner, event.$id, two.$id, [ama, kofi])).toEqual({ added: 1, removed: 1, total: 2 })
    expect(await inRound(two.$id)).toEqual([ama, kofi].sort())
    expect((await listRoundEntries(owner, two.$id)).every((e) => e.voteCount === 0)).toBe(true)
    // The same pick again changes nothing and is not audited again.
    await setRoundEntrants(owner, event.$id, two.$id, [kofi, ama])
    expect(fake.dump('audit_logs').filter((a) => a.action === 'round.entrants')).toHaveLength(2)
  })

  test('the closed round is never touched by a pick', async () => {
    const { event, one, two, nominees } = await twoRounds()
    const before = await inRound(one.$id)
    await setRoundEntrants(owner, event.$id, two.$id, [nominees[0].$id])
    expect(await inRound(one.$id)).toEqual(before)
    await expect(setRoundEntrants(owner, event.$id, one.$id, [])).rejects.toThrow(/roundClosed/)
  })

  test('only a pending round can be picked for; a live one is refused', async () => {
    const { event, two, nominees } = await twoRounds()
    await setRoundEntrants(owner, event.$id, two.$id, [nominees[0].$id])
    await openRound(owner, two.$id)
    await expect(setRoundEntrants(owner, event.$id, two.$id, [])).rejects.toThrow(/notPending/)
    expect(await inRound(two.$id)).toEqual([nominees[0].$id])
  })

  test('refuses nominees of another event, withdrawn nominees, unknown ids, staff and other tenants', async () => {
    const { event, two, nominees } = await twoRounds()
    const other = await createEvent(owner, { ...input, title: 'Another Event' })
    const otherCategory = await createCategory(owner, other.event.$id, 'Best Dressed')
    const stranger = (
      await createNominee(owner, { eventId: other.event.$id, categoryId: otherCategory.$id, name: 'Yaw Boateng' })
    ).nominee
    await expect(setRoundEntrants(owner, event.$id, two.$id, [stranger.$id])).rejects.toThrow(/nomineeNotInEvent/)
    await expect(setRoundEntrants(owner, event.$id, two.$id, ['nope'])).rejects.toThrow(/nomineeNotInEvent/)
    await fake.updateDocument('voteapp', 'nominees', nominees[2].$id, { status: 'withdrawn' })
    await expect(setRoundEntrants(owner, event.$id, two.$id, [nominees[2].$id])).rejects.toThrow(/nomineeNotInEvent/)
    // A refused pick leaves the round as it was.
    expect(await inRound(two.$id)).toEqual([])
    // The round must belong to the event named in the request.
    await expect(setRoundEntrants(owner, other.event.$id, two.$id, [])).rejects.toBeInstanceOf(TenantMismatchError)
    await expect(setRoundEntrants(staff, event.$id, two.$id, [])).rejects.toBeInstanceOf(ForbiddenError)
    await expect(setRoundEntrants(otherOrg, event.$id, two.$id, [])).rejects.toBeInstanceOf(TenantMismatchError)
  })

  test('a nominee added after round 1 closed joins the next open round at zero', async () => {
    const { event, category, one, two } = await twoRounds()
    expect((await nextOpenRound(owner, event.$id))?.$id).toBe(two.$id)
    const { nominee, entry } = await createNominee(owner, {
      eventId: event.$id,
      categoryId: category.$id,
      name: 'Late Entry',
    })
    expect(entry).toMatchObject({ roundId: two.$id, nomineeId: nominee.$id, voteCount: 0 })
    expect(await inRound(one.$id)).not.toContain(nominee.$id)
  })
})

describe('price per round (decision #30)', () => {
  test("a round uses its own price when set, else the event's", () => {
    expect(effectiveVotePrice({ votePrice: 50 }, null)).toBe(50)
    expect(effectiveVotePrice({ votePrice: 50 }, {})).toBe(50)
    expect(effectiveVotePrice({ votePrice: 50 }, { votePrice: null })).toBe(50)
    expect(effectiveVotePrice({ votePrice: 50 }, { votePrice: 200 })).toBe(200)
    // Nonsense on the row never becomes a price.
    expect(effectiveVotePrice({ votePrice: 50 }, { votePrice: 0 })).toBe(50)
    expect(effectiveVotePrice({ votePrice: 50 }, { votePrice: 1.5 })).toBe(50)
  })

  test('set, clear and validate on a pending round, in pesewas, audited', async () => {
    const { event, round } = await createEvent(owner, input)
    expect((await setRoundPrice(owner, event.$id, round.$id, '2.00')).votePrice).toBe(200)
    expect((await setRoundPrice(owner, event.$id, round.$id, '2.00')).votePrice).toBe(200)
    expect((await setRoundPrice(owner, event.$id, round.$id, '')).votePrice).toBeNull()
    await expect(setRoundPrice(owner, event.$id, round.$id, 'abc')).rejects.toThrow(/priceInvalid/)
    await expect(setRoundPrice(owner, event.$id, round.$id, '0')).rejects.toThrow(/priceZero/)
    const audit = fake.dump('audit_logs').filter((a) => a.action === 'round.price')
    expect(audit.map((a) => JSON.parse(a.metadata as string)).map((m) => [m.before, m.after])).toEqual([
      [null, 200],
      [200, null],
    ])
  })

  test('the price is fixed once the round is live or closed; staff and other tenants are refused', async () => {
    const { event, round } = await createEvent(owner, input)
    await expect(setRoundPrice(staff, event.$id, round.$id, '2.00')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(setRoundPrice(otherOrg, event.$id, round.$id, '2.00')).rejects.toBeInstanceOf(TenantMismatchError)
    await openRound(owner, round.$id)
    await expect(setRoundPrice(owner, event.$id, round.$id, '2.00')).rejects.toThrow(/notPending/)
    await closeRound(owner, round.$id)
    await expect(setRoundPrice(owner, event.$id, round.$id, '2.00')).rejects.toThrow(/roundClosed/)
  })
})
