import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))
const getSessionUserId = vi.fn()
vi.mock('../auth-session', () => ({ getSessionUserId: () => getSessionUserId() }))

import type { TenantContext } from '../db'
import { balanceFor, computeBalance } from '../ledger-server'
import {
  PAYOUT_LOCK_TTL_MS,
  PayoutError,
  cancelPayout,
  decidePayout,
  listAllPayouts,
  listPayouts,
  markPayoutPaid,
  parseDestination,
  payoutId,
  requestPayout,
  withPayoutLock,
} from '../payouts-server'
import { isSuperAdmin, requireSuperAdmin } from '../super-admin'
import { ForbiddenError } from '../tenant'

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const staff: TenantContext = { organizationId: 'org1', userId: 'u2', role: 'staff' }
const otherOrg: TenantContext = { organizationId: 'org2', userId: 'u3', role: 'owner' }
const momo = { kind: 'momo', phone: '0241234567', name: 'Faculty Treasurer' }

function credit(org: string, amount: number, key: string) {
  fake.seed('ledger_entries', {
    $id: `l_${key}`,
    organizationId: org,
    type: 'vote_credit',
    amount,
    paymentId: key,
    note: null,
  })
}
const request = (ctx: TenantContext, amountCedis: string, key = 'key_0123456789', destination: unknown = momo) =>
  requestPayout(ctx, { amountCedis, destination, idempotencyKey: key })

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  delete process.env.PAYOUT_MIN_PESEWAS
  fake = createFakeDatabases({ ...UNIQUE_INDEXES, payouts: [] })
  credit('org1', 9000, 'p1')
  credit('org1', 4500, 'p2')
  credit('org2', 100000, 'p3')
})
afterEach(() => {
  delete process.env.PAYOUT_MIN_PESEWAS
})

describe('balance', () => {
  test('credits, debits and reservations are integers that add up', () => {
    const b = computeBalance([{ amount: 9000 }, { amount: 4500 }, { amount: -2000 }], [{ amount: 1000 }])
    expect(b).toEqual({ credits: 13500, debits: -2000, reserved: 1000, available: 10500 })
  })

  test('is scoped to the organization', async () => {
    expect((await balanceFor(owner)).available).toBe(13500)
    expect((await balanceFor(otherOrg)).available).toBe(100000)
    expect((await balanceFor({ ...owner, organizationId: 'org9' })).available).toBe(0)
  })
})

describe('destinations', () => {
  test('momo needs a Ghanaian number and a name; bank needs the three fields', () => {
    expect(parseDestination(momo)).toEqual({ kind: 'momo', phone: '233241234567', name: 'Faculty Treasurer' })
    expect(
      parseDestination({ kind: 'bank', bankName: 'GCB', accountNumber: '1234 5678 90', accountName: 'Faculty' })
    ).toEqual({
      kind: 'bank',
      bankName: 'GCB',
      accountNumber: '1234567890',
      accountName: 'Faculty',
    })
    expect(() => parseDestination({ kind: 'momo', phone: '123', name: 'X' })).toThrow(/destinationInvalid/)
    expect(() => parseDestination({ kind: 'bank', bankName: 'GCB', accountNumber: '12', accountName: 'F' })).toThrow(
      /destinationInvalid/
    )
    expect(() => parseDestination({ kind: 'cash' })).toThrow(PayoutError)
  })
})

describe('requestPayout', () => {
  test('reserves the amount, converts cedis once, audits, and is idempotent per key', async () => {
    const { outcome, payout } = await request(owner, '100')
    expect(outcome).toBe('requested')
    expect(payout).toMatchObject({
      $id: payoutId('org1', 'key_0123456789'),
      amount: 10000,
      status: 'requested',
      destinationKind: 'momo',
      requestedBy: 'u1',
      organizationId: 'org1',
    })
    expect((await balanceFor(owner)).available).toBe(3500)
    expect((await request(owner, '100')).outcome).toBe('duplicate')
    expect(fake.dump('payouts')).toHaveLength(1)
    expect(fake.dump('audit_logs').map((l) => l.action)).toEqual(['payout.request'])
  })

  test('refuses more than the available balance, counting earlier reservations', async () => {
    await request(owner, '100', 'key_first_000001')
    await expect(request(owner, '40', 'key_second_00001')).rejects.toThrow(/insufficient/)
    await expect(request(owner, '35', 'key_third_000001')).resolves.toMatchObject({ outcome: 'requested' })
    expect((await balanceFor(owner)).available).toBe(0)
  })

  test('two concurrent requests may both reserve, but money out can never exceed credits', async () => {
    // Both read the same balance in the same instant: an over-reservation, not a loss.
    const [a, b] = await Promise.all([
      request(owner, '100', 'key_race_a_0001'),
      request(owner, '100', 'key_race_b_0001'),
    ])
    expect(fake.dump('payouts')).toHaveLength(2)
    await decidePayout('admin1', a.payout.$id, 'approved')
    await decidePayout('admin1', b.payout.$id, 'approved')
    expect((await markPayoutPaid('admin1', a.payout.$id)).outcome).toBe('paid')
    // 135.00 in, 100.00 out: the second cannot be paid.
    await expect(markPayoutPaid('admin1', b.payout.$id)).rejects.toThrow(/insufficient/)
    expect(fake.dump('ledger_entries').filter((l) => l.type === 'payout_debit')).toHaveLength(1)
    expect((await balanceFor(owner)).credits + (await balanceFor(owner)).debits).toBe(3500)
  })

  test('refuses bad amounts, below the minimum, staff, and never touches the ledger', async () => {
    await expect(request(owner, '0')).rejects.toThrow(/amountInvalid/)
    await expect(request(owner, 'abc')).rejects.toThrow(/amountInvalid/)
    process.env.PAYOUT_MIN_PESEWAS = '5000'
    await expect(request(owner, '20')).rejects.toThrow(/belowMinimum/)
    delete process.env.PAYOUT_MIN_PESEWAS
    await expect(request(staff, '10')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(request(owner, '10', 'short')).rejects.toThrow(/keyInvalid/)
    expect(fake.dump('ledger_entries')).toHaveLength(3)
  })
})

describe('decide, cancel and pay', () => {
  test('approve then paid writes exactly one debit in the same transaction; marking twice debits once', async () => {
    const { payout } = await request(owner, '100')
    await decidePayout('admin1', payout.$id, 'approved', 'ok')
    const { outcome } = await markPayoutPaid('admin1', payout.$id, 'MTN ref 123')
    expect(outcome).toBe('paid')
    const debits = fake.dump('ledger_entries').filter((l) => l.type === 'payout_debit')
    expect(debits).toHaveLength(1)
    expect(debits[0]).toMatchObject({ organizationId: 'org1', amount: -10000, paymentId: `payout:${payout.$id}` })
    expect(await balanceFor(owner)).toMatchObject({ credits: 13500, debits: -10000, reserved: 0, available: 3500 })
    expect((await markPayoutPaid('admin1', payout.$id)).outcome).toBe('duplicate')
    expect(fake.dump('ledger_entries').filter((l) => l.type === 'payout_debit')).toHaveLength(1)
    expect(fake.dump('audit_logs').map((l) => l.action)).toEqual(['payout.request', 'payout.approved', 'payout.paid'])
  })

  test('a failure inside the paid transaction leaves the payout approved and the ledger untouched', async () => {
    const { payout } = await request(owner, '100')
    await decidePayout('admin1', payout.$id, 'approved')
    fake.updateDocument.mockImplementationOnce(async () => {
      throw new Error('storage hiccup')
    })
    await expect(markPayoutPaid('admin1', payout.$id)).rejects.toThrow('storage hiccup')
    expect((await fake.getDocument('voteapp', 'payouts', payout.$id)).status).toBe('approved')
    expect(fake.dump('ledger_entries').filter((l) => l.type === 'payout_debit')).toHaveLength(0)
  })

  test('state machine: only requested can be decided or cancelled; only approved can be paid', async () => {
    const { payout } = await request(owner, '10')
    await expect(markPayoutPaid('admin1', payout.$id)).rejects.toThrow(/badTransition/)
    const cancelled = await cancelPayout(owner, payout.$id)
    expect(cancelled.status).toBe('rejected')
    await expect(decidePayout('admin1', payout.$id, 'approved')).rejects.toThrow(/badTransition/)
    await expect(cancelPayout(owner, payout.$id)).rejects.toThrow(/badTransition/)
    expect((await balanceFor(owner)).available).toBe(13500)

    const { payout: p2 } = await request(owner, '10', 'key_second_00001')
    await decidePayout('admin1', p2.$id, 'rejected', 'wrong account')
    expect((await balanceFor(owner)).available).toBe(13500)
    await expect(cancelPayout(otherOrg, p2.$id)).rejects.toThrow()
  })

  test('the super admin list spans organizations; the organizer list does not', async () => {
    await request(owner, '10', 'key_a_000000001')
    await request(otherOrg, '500', 'key_b_000000001')
    expect((await listAllPayouts()).map((p) => p.organizationId)).toEqual(['org1', 'org2'])
    expect((await listPayouts(owner)).map((p) => p.organizationId)).toEqual(['org1'])
  })
})

describe('integrity review fixes', () => {
  test('two payouts marked paid in the same instant: one pays, the other waits', async () => {
    const { payout: a } = await request(owner, '100', 'key_lock_a_0001')
    const { payout: b } = await request(owner, '35', 'key_lock_b_0001')
    await decidePayout('admin1', a.$id, 'approved')
    await decidePayout('admin1', b.$id, 'approved')
    const results = await Promise.allSettled([markPayoutPaid('admin1', a.$id), markPayoutPaid('admin2', b.$id)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(
      results.filter((r) => r.status === 'rejected' && /busy/.test(String((r as PromiseRejectedResult).reason)))
    ).toHaveLength(1)
    expect(fake.dump('payout_locks')).toHaveLength(0)
    const remaining = fake.dump('payouts').find((p) => p.status === 'approved')!
    expect((await markPayoutPaid('admin2', remaining.$id as string)).outcome).toBe('paid')
    expect(fake.dump('ledger_entries').filter((l) => l.type === 'payout_debit')).toHaveLength(2)
    expect((await balanceFor(owner)).available).toBe(0)
  })

  test('a lock left behind by a crashed holder is reclaimed after it expires', async () => {
    fake.seed('payout_locks', {
      $id: 'org1',
      organizationId: 'org1',
      holder: 'ghost',
      expiresAt: '2020-01-01T00:00:00Z',
    })
    expect(await withPayoutLock('org1', 'admin1', async () => 'ok')).toBe('ok')
    expect(fake.dump('payout_locks')).toHaveLength(0)
    fake.seed('payout_locks', {
      $id: 'org1',
      organizationId: 'org1',
      holder: 'alive',
      expiresAt: new Date(Date.now() + PAYOUT_LOCK_TTL_MS).toISOString(),
    })
    await expect(withPayoutLock('org1', 'admin1', async () => 'nope')).rejects.toThrow(/busy/)
    expect(fake.dump('payout_locks')).toHaveLength(1)
  })

  test('a cancel and an approval cannot both win', async () => {
    const { payout } = await request(owner, '10')
    const original = fake.getDocument.getMockImplementation()!
    fake.getDocument.mockImplementation(async (db: string, table: string, id: string, ...rest: unknown[]) => {
      const row = await original(db, table, id)
      return table === 'payouts' && rest.length > 1 ? { ...row, status: 'rejected' } : row
    })
    await expect(decidePayout('admin1', payout.$id, 'approved')).rejects.toThrow(/badTransition/)
    fake.getDocument.mockImplementation(original)
    expect((await fake.getDocument('voteapp', 'payouts', payout.$id)).status).toBe('requested')
    expect(fake.transactionStatuses()).toEqual(['committed', 'rolled_back'])
  })
})

describe('super admin check', () => {
  test('reads the flag from the users row, never from the request', async () => {
    fake.seed('users', { $id: 'boss', email: 'b@x.y', fullName: 'Boss', phone: null, isSuperAdmin: true })
    fake.seed('users', { $id: 'u1', email: 'u@x.y', fullName: 'U', phone: null, isSuperAdmin: false })
    expect(await isSuperAdmin('boss')).toBe(true)
    expect(await isSuperAdmin('u1')).toBe(false)
    expect(await isSuperAdmin('nobody')).toBe(false)
    expect(await isSuperAdmin(null)).toBe(false)
    getSessionUserId.mockResolvedValue(null)
    expect(await requireSuperAdmin()).toBeNull()
    getSessionUserId.mockResolvedValue('u1')
    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(ForbiddenError)
    getSessionUserId.mockResolvedValue('boss')
    expect(await requireSuperAdmin()).toBe('boss')
  })
})
