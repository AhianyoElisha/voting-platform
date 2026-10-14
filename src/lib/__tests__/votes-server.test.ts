import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import type { TenantContext } from '../db'
import { createEvent, setEventStatus } from '../events-server'
import { createCategory, createNominee } from '../nominees-server'
import { MockPaymentProvider, signMockPayload } from '../payments/mock'
import type { CallbackResult, PaymentProvider } from '../payments/provider'
import { closeRound } from '../rounds-server'
import {
  VoteError,
  confirmPayment,
  eventFigures,
  initiateVotePayment,
  paidVoteId,
  parseQuantity,
  reconcilePendingPayments,
  recountRoundEntry,
  tallyForRound,
} from '../votes-server'

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const otherOrg: TenantContext = { organizationId: 'org2', userId: 'u3', role: 'owner' }
const NOW = new Date('2026-11-10T12:00:00Z')

const eventInput = {
  title: 'Faculty Awards',
  votePriceCedis: '1.50',
  startsAt: '2026-11-01T00:00:00Z',
  endsAt: '2026-11-30T00:00:00Z',
  resultsVisibility: 'count',
}

async function seedLiveEvent(ctx = owner) {
  const { event, round } = await createEvent(ctx, eventInput)
  const category = await createCategory(ctx, event.$id, 'Most Influential')
  const { nominee, entry } = await createNominee(ctx, {
    eventId: event.$id,
    categoryId: category.$id,
    name: 'Ama Owusu',
  })
  await setEventStatus(ctx, event.$id, 'live')
  return { event, round, category, nominee, entry: entry! }
}

const provider = new MockPaymentProvider()

function callbackFor(reference: string, status: 'success' | 'failed' = 'success'): CallbackResult {
  return {
    providerReference: reference,
    status,
    raw: { providerReference: reference, status, via: 'test' },
    network: 'MOCK',
  }
}

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  process.env.PLATFORM_COMMISSION_BPS = '1000'
  process.env.MOCK_PAYMENT_SECRET = 'test-secret'
  fake = createFakeDatabases(UNIQUE_INDEXES)
  fake.seed('organizations', {
    $id: 'org1',
    name: 'Org 1',
    slug: 'org-1',
    status: 'active',
    commissionRate: null,
    moraleCandidatesEnabled: false,
  })
})

afterEach(() => {
  delete process.env.PLATFORM_COMMISSION_BPS
  delete process.env.MOCK_PAYMENT_SECRET
})

describe('parseQuantity (#16 placeholder)', () => {
  test('accepts positive integers within the ceiling', () => {
    expect(parseQuantity(1)).toBe(1)
    expect(parseQuantity('25')).toBe(25)
    expect(() => parseQuantity(0)).toThrow(VoteError)
    expect(() => parseQuantity(1.5)).toThrow(VoteError)
    expect(() => parseQuantity('abc')).toThrow(VoteError)
    expect(() => parseQuantity(10_001)).toThrow(VoteError)
  })
})

describe('initiateVotePayment (rules 1, 4a, 6)', () => {
  test('creates a pending payment on the live round with integer pesewas and the fee split', async () => {
    const { event, round, nominee } = await seedLiveEvent()
    const { payment, instructions } = await initiateVotePayment(
      { code: nominee.code, quantity: 10, phone: '024 123 4567' },
      { provider, now: NOW }
    )
    expect(payment.status).toBe('pending')
    expect(payment.organizationId).toBe('org1')
    expect(payment.eventId).toBe(event.$id)
    expect(payment.roundId).toBe(round.$id)
    expect(payment.nomineeId).toBe(nominee.$id)
    expect(payment.payerPhone).toBe('233241234567')
    expect(payment.amount).toBe(1500)
    expect(payment.platformFee).toBe(150)
    expect(payment.organizerNet).toBe(1350)
    expect(payment.providerReference).toBe(`mock_${payment.$id}`)
    expect(instructions).toBeTruthy()
    // Nothing is counted yet.
    expect(fake.dump('votes')).toHaveLength(0)
    expect(fake.dump('ledger_entries')).toHaveLength(0)
  })

  test('the payment exists as pending before the provider is called', async () => {
    const { nominee } = await seedLiveEvent()
    let pendingAtInitiate = 0
    const spy: PaymentProvider = {
      name: 'spy',
      async initiate(input) {
        pendingAtInitiate = fake
          .dump('payments')
          .filter((p) => p.$id === input.paymentId && p.status === 'pending').length
        return { providerReference: `spy_${input.paymentId}` }
      },
      async verifyCallback() {
        return null
      },
      async checkStatus() {
        return 'unknown'
      },
    }
    await initiateVotePayment({ code: nominee.code, quantity: 1, phone: '0241234567' }, { provider: spy, now: NOW })
    expect(pendingAtInitiate).toBe(1)
  })

  test('marks the payment failed when the provider throws', async () => {
    const { nominee } = await seedLiveEvent()
    const broken: PaymentProvider = {
      name: 'broken',
      async initiate() {
        throw new Error('gateway down')
      },
      async verifyCallback() {
        return null
      },
      async checkStatus() {
        return 'unknown'
      },
    }
    await expect(
      initiateVotePayment({ code: nominee.code, quantity: 1, phone: '0241234567' }, { provider: broken, now: NOW })
    ).rejects.toThrow(/providerFailed/)
    expect(fake.dump('payments').map((p) => p.status)).toEqual(['failed'])
  })

  test('refuses bad codes, phones, closed or unscheduled events and missing fees', async () => {
    const { event, nominee } = await seedLiveEvent()
    const base = { code: nominee.code, quantity: 1, phone: '0241234567' }
    await expect(initiateVotePayment({ ...base, code: '1' }, { provider, now: NOW })).rejects.toThrow(/nomineeNotFound/)
    await expect(initiateVotePayment({ ...base, phone: '12345' }, { provider, now: NOW })).rejects.toThrow(
      /phoneInvalid/
    )
    await expect(initiateVotePayment(base, { provider, now: new Date('2026-12-25T00:00:00Z') })).rejects.toThrow(
      /outsideWindow/
    )

    process.env.PLATFORM_COMMISSION_BPS = 'free'
    await expect(initiateVotePayment(base, { provider, now: NOW })).rejects.toThrow(/feesNotConfigured/)
    process.env.PLATFORM_COMMISSION_BPS = '1000'

    await setEventStatus(owner, event.$id, 'paused')
    await expect(initiateVotePayment(base, { provider, now: NOW })).rejects.toThrow(/eventNotLive/)
    expect(fake.dump('payments')).toHaveLength(0)
  })

  test('uses the organization commission override when set', async () => {
    fake.seed('organizations', {
      $id: 'org1',
      name: 'Org 1',
      slug: 'org-1',
      status: 'active',
      commissionRate: 700,
      moraleCandidatesEnabled: false,
    })
    const { nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 2, phone: '0241234567' },
      { provider, now: NOW }
    )
    expect(payment.amount).toBe(300)
    expect(payment.platformFee).toBe(21)
    expect(payment.organizerNet).toBe(279)
  })
})

describe('confirmPayment (rules 3, 4, 5)', () => {
  test('a verified success creates exactly one paid vote, bumps the tally and credits the ledger once', async () => {
    const { round, nominee, entry } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 10, phone: '0241234567' },
      { provider, now: NOW }
    )

    const { outcome, payment: confirmed } = await confirmPayment(callbackFor(payment.providerReference))
    expect(outcome).toBe('confirmed')
    expect(confirmed?.status).toBe('success')
    expect(confirmed?.confirmedAt).toBeTruthy()
    expect(confirmed?.rawCallback).toContain('"via":"test"')

    const votes = fake.dump('votes')
    expect(votes).toHaveLength(1)
    expect(votes[0]).toMatchObject({
      $id: paidVoteId(payment.$id),
      source: 'paid',
      paymentId: payment.$id,
      quantity: 10,
      roundId: round.$id,
      nomineeId: nominee.$id,
      organizationId: 'org1',
      grantedBy: null,
    })
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(10)

    const ledger = fake.dump('ledger_entries')
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      organizationId: 'org1',
      type: 'vote_credit',
      amount: 1350,
      paymentId: payment.$id,
    })
    expect(fake.transactionStatuses()).toEqual(['committed'])
  })

  test('replaying the same callback changes nothing', async () => {
    const { entry, nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 3, phone: '0241234567' },
      { provider, now: NOW }
    )
    await confirmPayment(callbackFor(payment.providerReference))
    const again = await confirmPayment(callbackFor(payment.providerReference))
    const third = await confirmPayment({ ...callbackFor(payment.providerReference), raw: { different: true } })
    expect(again.outcome).toBe('duplicate')
    expect(third.outcome).toBe('duplicate')
    expect(fake.dump('votes')).toHaveLength(1)
    expect(fake.dump('ledger_entries')).toHaveLength(1)
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(3)
    // The stored raw payload is the first one.
    expect((await fake.getDocument('voteapp', 'payments', payment.$id)).rawCallback).toContain('"via":"test"')
  })

  test('two concurrent confirmations of one reference count once', async () => {
    const { entry, nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 5, phone: '0241234567' },
      { provider, now: NOW }
    )
    const results = await Promise.all([
      confirmPayment(callbackFor(payment.providerReference)),
      confirmPayment(callbackFor(payment.providerReference)),
    ])
    expect(results.map((r) => r.outcome).sort()).toEqual(['confirmed', 'duplicate'])
    expect(fake.dump('votes')).toHaveLength(1)
    expect(fake.dump('ledger_entries')).toHaveLength(1)
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(5)
    expect(fake.transactionStatuses().sort()).toEqual(['committed', 'failed'])
  })

  test('a failure inside the transaction rolls everything back', async () => {
    const { entry, nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 4, phone: '0241234567' },
      { provider, now: NOW }
    )
    fake.incrementDocumentAttribute.mockImplementationOnce(async () => {
      throw new Error('storage hiccup')
    })
    await expect(confirmPayment(callbackFor(payment.providerReference))).rejects.toThrow('storage hiccup')
    expect((await fake.getDocument('voteapp', 'payments', payment.$id)).status).toBe('pending')
    expect(fake.dump('votes')).toHaveLength(0)
    expect(fake.dump('ledger_entries')).toHaveLength(0)
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(0)
    expect(fake.transactionStatuses()).toEqual(['rolled_back'])

    // The next callback succeeds normally.
    const retry = await confirmPayment(callbackFor(payment.providerReference))
    expect(retry.outcome).toBe('confirmed')
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(4)
  })

  test('a failed callback marks the payment failed and counts nothing; a later success still counts', async () => {
    const { entry, nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 2, phone: '0241234567' },
      { provider, now: NOW }
    )
    const failed = await confirmPayment(callbackFor(payment.providerReference, 'failed'))
    expect(failed.outcome).toBe('failed')
    expect(failed.payment?.status).toBe('failed')
    expect(fake.dump('votes')).toHaveLength(0)

    // Money did move after all (provider corrected itself): the verified success wins.
    const late = await confirmPayment(callbackFor(payment.providerReference))
    expect(late.outcome).toBe('confirmed')
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(2)
  })

  test('an unknown reference writes nothing', async () => {
    await seedLiveEvent()
    const { outcome } = await confirmPayment(callbackFor('mock_nope'))
    expect(outcome).toBe('unknown')
    expect(fake.dump('votes')).toHaveLength(0)
  })

  test('votes attach to the round live at initiation, even if it closed before the callback (#13 placeholder)', async () => {
    const { round, entry, nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 7, phone: '0241234567' },
      { provider, now: NOW }
    )
    await closeRound(owner, round.$id)
    const { outcome } = await confirmPayment(callbackFor(payment.providerReference))
    expect(outcome).toBe('confirmed')
    expect(fake.dump('votes')[0]).toMatchObject({ roundId: round.$id, quantity: 7 })
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(7)
    expect(
      fake.dump('audit_logs').some((l) => l.action === 'vote.late' && l.target === `payments/${payment.$id}`)
    ).toBe(true)
  })

  test('the mock provider only accepts correctly signed callbacks', async () => {
    const { nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 1, phone: '0241234567' },
      { provider, now: NOW }
    )
    const body = JSON.stringify({ providerReference: payment.providerReference, status: 'success' })

    expect(await provider.verifyCallback(new Headers(), body)).toBeNull()
    expect(await provider.verifyCallback(new Headers({ 'x-mock-signature': 'deadbeef' }), body)).toBeNull()
    const tampered = body.replace('success', 'failed')
    expect(
      await provider.verifyCallback(new Headers({ 'x-mock-signature': signMockPayload(body) }), tampered)
    ).toBeNull()

    const verified = await provider.verifyCallback(new Headers({ 'x-mock-signature': signMockPayload(body) }), body)
    expect(verified).toMatchObject({ providerReference: payment.providerReference, status: 'success' })
    const { outcome } = await confirmPayment(verified!)
    expect(outcome).toBe('confirmed')
  })
})

describe('provider reference never stored (integrity review finding 1)', () => {
  test('the payment stays pending and the callback still matches by client reference', async () => {
    const { entry, nominee } = await seedLiveEvent()
    const original = fake.updateDocument.getMockImplementation()!
    // The one update after provider.initiate (storing the reference) fails.
    fake.updateDocument.mockImplementationOnce(async () => {
      throw new Error('network blip')
    })
    fake.updateDocument.mockImplementation(original)

    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 6, phone: '0241234567' },
      { provider, now: NOW }
    )
    expect(payment.status).toBe('pending')
    expect(payment.providerReference).toBe(`local_${payment.$id}`)

    // The provider's callback carries its own reference plus our id.
    const { outcome } = await confirmPayment({
      providerReference: `mock_${payment.$id}`,
      clientReference: payment.$id,
      status: 'success',
      raw: { late: true },
    })
    expect(outcome).toBe('confirmed')
    const stored = await fake.getDocument('voteapp', 'payments', payment.$id)
    expect(stored.status).toBe('success')
    expect(stored.providerReference).toBe(`mock_${payment.$id}`)
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(6)

    // And the real reference now answers as a duplicate.
    const again = await confirmPayment(callbackFor(`mock_${payment.$id}`))
    expect(again.outcome).toBe('duplicate')
    expect(fake.dump('votes')).toHaveLength(1)
  })

  test('a client reference cannot hijack a payment that has a real reference', async () => {
    const { nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 1, phone: '0241234567' },
      { provider, now: NOW }
    )
    const { outcome } = await confirmPayment({
      providerReference: 'other_ref',
      clientReference: payment.$id,
      status: 'success',
      raw: {},
    })
    expect(outcome).toBe('unknown')
    expect(fake.dump('votes')).toHaveLength(0)
  })

  test('reconciliation re-checks placeholder references by payment id', async () => {
    const { entry, nominee } = await seedLiveEvent()
    const original = fake.updateDocument.getMockImplementation()!
    fake.updateDocument.mockImplementationOnce(async () => {
      throw new Error('network blip')
    })
    fake.updateDocument.mockImplementation(original)
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 2, phone: '0241234567' },
      { provider, now: NOW }
    )

    const checking: PaymentProvider = {
      ...provider,
      name: 'mock',
      initiate: provider.initiate.bind(provider),
      verifyCallback: provider.verifyCallback.bind(provider),
      async checkStatus({ clientReference }) {
        return clientReference === payment.$id ? 'success' : 'unknown'
      },
    }
    const totals = await reconcilePendingPayments({ provider: checking, now: new Date(Date.now() + 3_600_000) })
    expect(totals).toMatchObject({ checked: 1, confirmed: 1 })
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(2)
  })
})

describe('commit failures (integrity review finding 3)', () => {
  test('a non-409 commit failure after a concurrent success is reported as duplicate', async () => {
    const { entry, nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 3, phone: '0241234567' },
      { provider, now: NOW }
    )
    await confirmPayment(callbackFor(payment.providerReference))

    // Simulate a racing caller that read `pending` before the other commit landed.
    const stale = { ...(await fake.getDocument('voteapp', 'payments', payment.$id)), status: 'pending' }
    fake.listDocuments.mockImplementationOnce(async () => ({ total: 1, documents: [stale] }))
    fake.getDocument.mockImplementationOnce(async () => ({ ...stale }))
    fake.updateTransaction.mockImplementationOnce(async () => {
      throw new Error('transaction failed: conflicting write')
    })

    const { outcome } = await confirmPayment(callbackFor(payment.providerReference))
    expect(outcome).toBe('duplicate')
    expect(fake.dump('votes')).toHaveLength(1)
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(3)
  })

  test('a late vote and its audit row roll back together', async () => {
    const { round, entry, nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 7, phone: '0241234567' },
      { provider, now: NOW }
    )
    await closeRound(owner, round.$id)
    const auditRowsBefore = fake.dump('audit_logs').length
    fake.updateTransaction.mockImplementationOnce(async (id: string, commit?: boolean) => {
      if (commit) throw new Error('commit failed')
      return { $id: id, status: 'failed', operations: 0 }
    })
    await expect(confirmPayment(callbackFor(payment.providerReference))).rejects.toThrow('commit failed')
    expect(fake.dump('audit_logs')).toHaveLength(auditRowsBefore)
    expect(fake.dump('votes')).toHaveLength(0)
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(0)
    expect((await fake.getDocument('voteapp', 'payments', payment.$id)).status).toBe('pending')
  })
})

describe('client-reference fallback by provider (integrity review, Hubtel)', () => {
  test('a verified result from the same provider matches by payment id even when the provider id changed', async () => {
    const { entry, nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 2, phone: '0241234567' },
      { provider, now: NOW }
    )
    expect(payment.providerReference).toBe(`mock_${payment.$id}`)
    const { outcome } = await confirmPayment({
      provider: 'mock',
      providerReference: 'different_id_from_status_api',
      clientReference: payment.$id,
      status: 'success',
      raw: {},
    })
    expect(outcome).toBe('confirmed')
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(2)
    // The stored reference is kept, since it was real.
    expect((await fake.getDocument('voteapp', 'payments', payment.$id)).providerReference).toBe(`mock_${payment.$id}`)
  })

  test('a result from a different provider, or with no provider, cannot claim it', async () => {
    const { nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 2, phone: '0241234567' },
      { provider, now: NOW }
    )
    const other = await confirmPayment({
      provider: 'hubtel',
      providerReference: 'x',
      clientReference: payment.$id,
      status: 'success',
      raw: {},
    })
    expect(other.outcome).toBe('unknown')
    const anon = await confirmPayment({
      providerReference: 'x',
      clientReference: payment.$id,
      status: 'success',
      raw: {},
    })
    expect(anon.outcome).toBe('unknown')
    expect(fake.dump('votes')).toHaveLength(0)
  })
})

describe('reconciliation resilience', () => {
  test('a provider fault on one payment does not stop the others', async () => {
    const { nominee } = await seedLiveEvent()
    const { payment: a } = await initiateVotePayment(
      { code: nominee.code, quantity: 1, phone: '0241234567' },
      { provider, now: NOW }
    )
    const { payment: b } = await initiateVotePayment(
      { code: nominee.code, quantity: 1, phone: '0241234567' },
      { provider, now: NOW }
    )
    const flaky: PaymentProvider = {
      name: 'mock',
      initiate: provider.initiate.bind(provider),
      verifyCallback: provider.verifyCallback.bind(provider),
      async checkStatus({ clientReference }) {
        if (clientReference === a.$id) throw new Error('429 slow down')
        return 'success'
      },
    }
    const totals = await reconcilePendingPayments({ provider: flaky, now: new Date(Date.now() + 3_600_000) })
    expect(totals).toEqual({ checked: 2, confirmed: 1, failed: 0, skipped: 0, errors: 1 })
    expect((await fake.getDocument('voteapp', 'payments', a.$id)).status).toBe('pending')
    expect((await fake.getDocument('voteapp', 'payments', b.$id)).status).toBe('success')
  })

  test('uses verifiedResult alone when the provider offers it', async () => {
    const { nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 3, phone: '0241234567' },
      { provider, now: NOW }
    )
    const checkStatus = vi.fn()
    const rich: PaymentProvider = {
      name: 'mock',
      initiate: provider.initiate.bind(provider),
      verifyCallback: provider.verifyCallback.bind(provider),
      checkStatus,
      async verifiedResult(clientReference) {
        return {
          provider: 'mock',
          providerReference: `mock_${clientReference}`,
          clientReference,
          status: 'success',
          amountPesewas: 450,
          raw: { via: 'status' },
        }
      },
    }
    const totals = await reconcilePendingPayments({ provider: rich, now: new Date(Date.now() + 3_600_000) })
    expect(totals.confirmed).toBe(1)
    expect(checkStatus).not.toHaveBeenCalled()
    expect((await fake.getDocument('voteapp', 'payments', payment.$id)).rawCallback).toContain('"via":"status"')
  })
})

describe('amount guard', () => {
  test('a verified result whose amount differs from the payment is never credited', async () => {
    const { entry, nominee } = await seedLiveEvent()
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 10, phone: '0241234567' },
      { provider, now: NOW }
    )
    expect(payment.amount).toBe(1500)
    const { outcome } = await confirmPayment({ ...callbackFor(payment.providerReference), amountPesewas: 1000 })
    expect(outcome).toBe('mismatch')
    expect((await fake.getDocument('voteapp', 'payments', payment.$id)).status).toBe('pending')
    expect(fake.dump('votes')).toHaveLength(0)
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(0)
    expect(fake.dump('audit_logs').filter((l) => l.action === 'payment.amount_mismatch')).toHaveLength(1)
    expect((await fake.getDocument('voteapp', 'payments', payment.$id)).rawCallback).toContain('"amount_mismatch"')

    // A repeat (e.g. the next reconciliation run) is quiet.
    const again = await confirmPayment({ ...callbackFor(payment.providerReference), amountPesewas: 1000 })
    expect(again.outcome).toBe('mismatch')
    expect(fake.dump('audit_logs').filter((l) => l.action === 'payment.amount_mismatch')).toHaveLength(1)

    // The matching amount still confirms.
    const ok = await confirmPayment({ ...callbackFor(payment.providerReference), amountPesewas: 1500 })
    expect(ok.outcome).toBe('confirmed')
  })
})

describe('tallies and figures (PRD 5.4)', () => {
  test('per-round tally, dashboard figures and recount agree, and other tenants see nothing', async () => {
    const { event, round, nominee, category, entry } = await seedLiveEvent()
    const { nominee: second } = await createNominee(owner, {
      eventId: event.$id,
      categoryId: category.$id,
      name: 'Kofi Mensah',
    })
    for (const [code, qty] of [
      [nominee.code, 10],
      [second.code, 4],
      [nominee.code, 1],
    ] as const) {
      const { payment } = await initiateVotePayment(
        { code, quantity: qty, phone: '0241234567' },
        { provider, now: NOW }
      )
      await confirmPayment(callbackFor(payment.providerReference))
    }
    // One abandoned payment must not count anywhere.
    await initiateVotePayment({ code: second.code, quantity: 100, phone: '0241234567' }, { provider, now: NOW })

    const tally = await tallyForRound(owner, round.$id)
    expect(tally.map((r) => [r.nominee.name, r.entry.voteCount])).toEqual([
      ['Ama Owusu', 11],
      ['Kofi Mensah', 4],
    ])

    const figures = await eventFigures(owner, event.$id)
    expect(figures).toEqual({
      paidVotes: 15,
      freeVotes: 0,
      totalVotes: 15,
      gross: 2250,
      platformShare: 225,
      organizerShare: 2025,
      successfulPayments: 3,
    })

    expect(await recountRoundEntry(owner, entry.$id)).toBe(11)
    await expect(tallyForRound(otherOrg, round.$id)).resolves.toHaveLength(0)
    await expect(eventFigures(otherOrg, event.$id)).resolves.toMatchObject({ paidVotes: 0, gross: 0 })
    await expect(recountRoundEntry(otherOrg, entry.$id)).rejects.toThrow(/another organization/)
  })
})

describe('reconcilePendingPayments (rule 5)', () => {
  test('re-checks stale pending payments through the provider and applies the answer', async () => {
    const { entry, nominee } = await seedLiveEvent()
    const { payment: a } = await initiateVotePayment(
      { code: nominee.code, quantity: 2, phone: '0241234567' },
      { provider, now: NOW }
    )
    const { payment: b } = await initiateVotePayment(
      { code: nominee.code, quantity: 3, phone: '0241234567' },
      { provider, now: NOW }
    )
    const { payment: c } = await initiateVotePayment(
      { code: nominee.code, quantity: 4, phone: '0241234567' },
      { provider, now: NOW }
    )
    const answers: Record<string, 'success' | 'failed' | 'pending'> = {
      [a.providerReference]: 'success',
      [b.providerReference]: 'failed',
      [c.providerReference]: 'pending',
    }
    const checking: PaymentProvider = {
      name: 'mock',
      initiate: provider.initiate.bind(provider),
      verifyCallback: provider.verifyCallback.bind(provider),
      async checkStatus({ providerReference }) {
        return answers[providerReference] ?? 'unknown'
      },
    }
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const totals = await reconcilePendingPayments({ provider: checking, now: future })
    expect(totals).toEqual({ checked: 3, confirmed: 1, failed: 1, skipped: 1, errors: 0 })
    expect((await fake.getDocument('voteapp', 'payments', a.$id)).status).toBe('success')
    expect((await fake.getDocument('voteapp', 'payments', b.$id)).status).toBe('failed')
    expect((await fake.getDocument('voteapp', 'payments', c.$id)).status).toBe('pending')
    expect((await fake.getDocument('voteapp', 'round_entries', entry.$id)).voteCount).toBe(2)

    // Running again is a no-op for the settled ones.
    const again = await reconcilePendingPayments({ provider: checking, now: future })
    expect(again).toEqual({ checked: 1, confirmed: 0, failed: 0, skipped: 1, errors: 0 })
  })

  test('leaves fresh pending payments alone', async () => {
    const { nominee } = await seedLiveEvent()
    await initiateVotePayment({ code: nominee.code, quantity: 2, phone: '0241234567' }, { provider, now: NOW })
    // The fake stamps rows at 2026-10-14T00:00:00Z plus a few ms; one minute later is well inside the grace period.
    const totals = await reconcilePendingPayments({ provider, now: new Date('2026-10-14T00:01:00Z') })
    expect(totals.checked).toBe(0)
  })
})
