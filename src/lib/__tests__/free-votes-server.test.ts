import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import type { TenantContext } from '../db'
import { createEvent, setEventStatus } from '../events-server'
import { FreeVoteError, canGrantFreeVotes, freeVoteId, grantFreeVotes, listFreeVoteGrants } from '../free-votes-server'
import { createCategory, createNominee } from '../nominees-server'
import { closeRound } from '../rounds-server'
import { ForbiddenError } from '../tenant'
import { eventFigures, recountRoundEntry, tallyForRound } from '../votes-server'

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const staff: TenantContext = { organizationId: 'org1', userId: 'u2', role: 'staff' }
const otherOrg: TenantContext = { organizationId: 'org2', userId: 'u3', role: 'owner' }

const orgRow = (freeVotesEnabled: boolean) => ({
  $id: 'org1',
  name: 'Org 1',
  slug: 'org-1',
  status: 'active',
  moraleCandidatesEnabled: true,
  freeVotesEnabled,
})

async function seed(freeVotesEnabled = true, live = true) {
  const { event, round } = await createEvent(owner, {
    title: 'Awards',
    votePriceCedis: '1',
    startsAt: '2026-11-01T00:00:00Z',
    endsAt: '2026-11-30T00:00:00Z',
    resultsVisibility: 'count',
    freeVotesEnabled,
  })
  const category = await createCategory(owner, event.$id, 'Most Influential')
  const { nominee, entry } = await createNominee(owner, {
    eventId: event.$id,
    categoryId: category.$id,
    name: 'Ama Owusu',
  })
  if (live) await setEventStatus(owner, event.$id, 'live')
  return { event, round, category, nominee, entry: entry! }
}

const grant = (
  ctx: TenantContext,
  nomineeId: string,
  quantity: unknown = 100,
  key = 'key_0123456789',
  reason = 'Launch boost'
) => grantFreeVotes(ctx, { nomineeId, quantity, reason, idempotencyKey: key })

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  delete process.env.FREE_VOTES_ENABLED
  fake = createFakeDatabases(UNIQUE_INDEXES)
  fake.seed('organizations', orgRow(true))
})
afterEach(() => {
  delete process.env.FREE_VOTES_ENABLED
})

describe('gate', () => {
  test('all three switches and a manager role', () => {
    const on = { platformEnabled: true, organizationEnabled: true, eventEnabled: true, role: 'admin' as const }
    expect(canGrantFreeVotes(on)).toBe(true)
    expect(canGrantFreeVotes({ ...on, platformEnabled: false })).toBe(false)
    expect(canGrantFreeVotes({ ...on, organizationEnabled: false })).toBe(false)
    expect(canGrantFreeVotes({ ...on, eventEnabled: false })).toBe(false)
    expect(canGrantFreeVotes({ ...on, role: 'staff' })).toBe(false)
  })
})

describe('grantFreeVotes (rule 3a)', () => {
  test('one transaction: the vote, the tally increment and the audit row; never a payment or ledger row', async () => {
    const { nominee, entry, round, event } = await seed()
    const { outcome, vote } = await grant(owner, nominee.$id, 250)
    expect(outcome).toBe('granted')
    expect(vote).toMatchObject({
      $id: freeVoteId('org1', 'key_0123456789'),
      source: 'free',
      paymentId: null,
      grantedBy: 'u1',
      reason: 'Launch boost',
      quantity: 250,
      roundId: round.$id,
      eventId: event.$id,
      organizationId: 'org1',
    })
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(250)
    const audit = fake.dump('audit_logs').filter((l) => l.action === 'vote.grant_free')
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actorId: 'u1', organizationId: 'org1', target: `nominees/${nominee.$id}` })
    expect(JSON.parse(audit[0].metadata as string)).toMatchObject({
      quantity: 250,
      reason: 'Launch boost',
      voteId: vote.$id,
    })
    expect(fake.dump('payments')).toHaveLength(0)
    expect(fake.dump('ledger_entries')).toHaveLength(0)
    expect(fake.transactionStatuses()).toEqual(['committed'])
  })

  test('a failure inside rolls all three back', async () => {
    const { nominee, entry } = await seed()
    fake.incrementDocumentAttribute.mockImplementationOnce(async () => {
      throw new Error('storage hiccup')
    })
    await expect(grant(owner, nominee.$id)).rejects.toThrow('storage hiccup')
    expect(fake.dump('votes')).toHaveLength(0)
    expect(fake.dump('audit_logs').filter((l) => l.action === 'vote.grant_free')).toHaveLength(0)
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(0)
  })

  test('the same idempotency key grants once; a new key grants again', async () => {
    const { nominee, entry } = await seed()
    await grant(owner, nominee.$id, 10, 'key_same_000001')
    const again = await grant(owner, nominee.$id, 10, 'key_same_000001')
    expect(again.outcome).toBe('duplicate')
    expect(fake.dump('votes')).toHaveLength(1)
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(10)
    await grant(owner, nominee.$id, 5, 'key_other_00001')
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(15)
    // Keys are scoped to the organization: another tenant's identical key is a different vote id.
    expect(freeVoteId('org1', 'k')).not.toBe(freeVoteId('org2', 'k'))
  })

  test('refusals: staff, other tenant, switches, no live round, closed round, closed event, bad input', async () => {
    const { nominee, event, round } = await seed()
    await expect(grant(staff, nominee.$id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(grant(otherOrg, nominee.$id)).rejects.toThrow()
    await expect(grant(owner, nominee.$id, 0)).rejects.toThrow(/quantityInvalid/)
    await expect(grant(owner, nominee.$id, 10001)).rejects.toThrow(/quantityInvalid/)
    await expect(grant(owner, nominee.$id, 5, 'key_0123456789', '  ')).rejects.toThrow(/reasonInvalid/)
    await expect(grant(owner, nominee.$id, 5, 'short')).rejects.toThrow(/keyInvalid/)

    process.env.FREE_VOTES_ENABLED = 'false'
    await expect(grant(owner, nominee.$id)).rejects.toThrow(/disabled/)
    delete process.env.FREE_VOTES_ENABLED
    fake.seed('organizations', orgRow(false))
    await expect(grant(owner, nominee.$id)).rejects.toThrow(/disabled/)
    fake.seed('organizations', orgRow(true))

    await closeRound(owner, round.$id)
    await expect(grant(owner, nominee.$id)).rejects.toThrow(/noLiveRound/)
    await setEventStatus(owner, event.$id, 'closed')
    await expect(grant(owner, nominee.$id)).rejects.toThrow(/eventClosed/)
    expect(fake.dump('votes')).toHaveLength(0)
  })

  test('an event that has not opted in refuses', async () => {
    const { nominee } = await seed(false)
    await expect(grant(owner, nominee.$id)).rejects.toBeInstanceOf(FreeVoteError)
    expect(fake.dump('votes')).toHaveLength(0)
  })
})

describe('integrity review fixes', () => {
  test('a nominee from another event of the same workspace is refused before anything is written', async () => {
    const { nominee } = await seed()
    await expect(
      grantFreeVotes(owner, {
        nomineeId: nominee.$id,
        quantity: 5,
        reason: 'Boost',
        idempotencyKey: 'key_0123456789',
        expectedEventId: 'some_other_event',
      })
    ).rejects.toThrow(/wrongEvent/)
    expect(fake.dump('votes')).toHaveLength(0)
    expect(fake.dump('audit_logs').filter((l) => l.action === 'vote.grant_free')).toHaveLength(0)
  })

  test('a round that closes between the check and the commit gets nothing', async () => {
    const { nominee, round, entry } = await seed()
    // The committed round is live when the grant looks, but the in-transaction read sees it closed.
    const original = fake.getDocument.getMockImplementation()!
    fake.getDocument.mockImplementation(async (db: string, table: string, id: string, ...rest: unknown[]) => {
      const row = await original(db, table, id)
      return table === 'rounds' && id === round.$id && rest.length > 1 ? { ...row, status: 'closed' } : row
    })
    await expect(grant(owner, nominee.$id)).rejects.toThrow(/roundClosed/)
    fake.getDocument.mockImplementation(original)
    expect(fake.dump('votes')).toHaveLength(0)
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(0)
    expect(fake.transactionStatuses()).toEqual(['rolled_back'])
  })
})

describe('free votes in tallies and figures', () => {
  test('counted separately everywhere, never in revenue', async () => {
    const { nominee, event, round, entry } = await seed()
    await grant(owner, nominee.$id, 40, 'key_a_000000001')
    await grant(owner, nominee.$id, 2, 'key_b_000000001')
    const tally = await tallyForRound(owner, round.$id)
    expect(tally[0]).toMatchObject({ free: 42 })
    expect(tally[0].entry.voteCount).toBe(42)
    expect(await eventFigures(owner, event.$id)).toMatchObject({
      paidVotes: 0,
      freeVotes: 42,
      totalVotes: 42,
      gross: 0,
      organizerShare: 0,
    })
    expect(await recountRoundEntry(owner, entry.$id)).toBe(42)
    expect((await listFreeVoteGrants(owner, event.$id)).map((g) => g.quantity)).toEqual([2, 40])
    expect(await listFreeVoteGrants(otherOrg, event.$id)).toEqual([])
  })
})
