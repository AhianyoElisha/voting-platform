import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import type { TenantContext } from '../db'
import { createEvent, setEventStatus } from '../events-server'
import { MockPaymentProvider } from '../payments/mock'
import type { CallbackResult } from '../payments/provider'
import { resetRateLimits } from '../rate-limit'
import { ForbiddenError } from '../tenant'
import { buyerTickets, initiateTicketPayment } from '../tickets/purchase-server'
import { scanTicket } from '../tickets/scan-server'
import {
  TierError,
  createTier,
  listPublicTiers,
  listTickets,
  normalizeTierInput,
  ticketFigures,
  updateTier,
} from '../tickets/tiers-server'
import { paymentAccessKey, ticketId, verifyTicketToken } from '../tickets/token'
import { confirmPayment } from '../votes-server'

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const scanner: TenantContext = { organizationId: 'org1', userId: 'u_door', role: 'scanner' }
const designer: TenantContext = { organizationId: 'org1', userId: 'u5', role: 'designer' }
const otherOrg: TenantContext = { organizationId: 'org2', userId: 'u3', role: 'owner' }
const NOW = new Date('2026-10-14T00:01:00Z')
const provider = new MockPaymentProvider()

async function seed() {
  const { event } = await createEvent(owner, {
    title: 'Faculty Dinner',
    votePriceCedis: '1',
    startsAt: '2026-11-01T00:00:00Z',
    endsAt: '2026-11-30T00:00:00Z',
    resultsVisibility: 'hidden',
  })
  await setEventStatus(owner, event.$id, 'scheduled')
  const tier = await createTier(owner, event.$id, { name: 'Regular', priceCedis: '50', quantityAvailable: 3 })
  return { event, tier }
}

const callbackFor = (reference: string, status: 'success' | 'failed' = 'success'): CallbackResult => ({
  provider: 'mock',
  providerReference: reference,
  clientReference: reference.replace(/^mock_/, ''),
  status,
  raw: { reference, status },
})

const buy = (tierId: string, quantity: number, phone = '0241234567', extra: { email?: string; name?: string } = {}) =>
  initiateTicketPayment({ tierId, quantity, phone, ...extra }, { provider, now: NOW })

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  process.env.MOCK_PAYMENT_SECRET = 's'
  process.env.TICKET_SECRET = 't'.repeat(32)
  fake = createFakeDatabases(UNIQUE_INDEXES)
  fake.seed('organizations', {
    $id: 'org1',
    name: 'Org 1',
    slug: 'org-1',
    status: 'active',
    commissionRate: null,
    moraleCandidatesEnabled: false,
  })
  resetRateLimits()
})
afterEach(() => {
  delete process.env.MOCK_PAYMENT_SECRET
  delete process.env.TICKET_SECRET
})

describe('tiers', () => {
  test('prices convert once to pesewas; validation; manager only; tenant scoped', async () => {
    const { event, tier } = await seed()
    expect(tier).toMatchObject({ price: 5000, quantitySold: 0, status: 'active', order: 1, organizationId: 'org1' })
    expect(() => normalizeTierInput({ name: 'Free', priceCedis: '0' })).toThrow(/priceInvalid/)
    expect(() => normalizeTierInput({ name: 'X', priceCedis: '1' })).toThrow(TierError)
    expect(() => normalizeTierInput({ name: 'VIP', priceCedis: 'abc' })).toThrow(/priceInvalid/)
    expect(() => normalizeTierInput({ name: 'VIP', priceCedis: '1', quantityAvailable: -1 })).toThrow(/quantityInvalid/)
    expect(() =>
      normalizeTierInput({
        name: 'VIP',
        priceCedis: '1',
        salesStart: '2026-11-02T00:00:00Z',
        salesEnd: '2026-11-01T00:00:00Z',
      })
    ).toThrow(/datesInvalid/)
    await expect(createTier(designer, event.$id, { name: 'VIP', priceCedis: '1' })).rejects.toBeInstanceOf(
      ForbiddenError
    )
    await expect(createTier(otherOrg, event.$id, { name: 'VIP', priceCedis: '1' })).rejects.toThrow()
    const hidden = await updateTier(owner, tier.$id, { status: 'hidden' })
    expect(hidden.status).toBe('hidden')
    expect(await listPublicTiers('org1', event.$id)).toEqual([])
    expect(await listPublicTiers('org2', event.$id)).toEqual([])
  })
})

describe('purchase initiation (rules 1, 6)', () => {
  test('refuses to start a purchase when the ticket secret is missing, before any payment exists', async () => {
    const { tier } = await seed()
    delete process.env.TICKET_SECRET
    await expect(buy(tier.$id, 1)).rejects.toThrow(/ticketsNotConfigured/)
    expect(fake.dump('payments')).toHaveLength(0)
  })

  test('creates a pending ticket payment with the fee split and no tickets', async () => {
    const { tier, event } = await seed()
    const { payment } = await buy(tier.$id, 2, '024 123 4567', { email: ' Buyer@Example.com ', name: 'Kofi Mensah' })
    expect(payment).toMatchObject({
      status: 'pending',
      purpose: 'ticket',
      tierId: tier.$id,
      eventId: event.$id,
      roundId: null,
      nomineeId: null,
      quantity: 2,
      amount: 10000,
      platformFee: 1000,
      organizerNet: 9000,
      payerPhone: '233241234567',
      payerEmail: 'buyer@example.com',
      payerName: 'Kofi Mensah',
    })
    expect(fake.dump('tickets')).toHaveLength(0)
  })

  test('refuses hidden tiers, closed sales windows, draft and closed events, bad input', async () => {
    const { tier, event } = await seed()
    await expect(buy(tier.$id, 0)).rejects.toThrow(/quantityInvalid/)
    await expect(buy(tier.$id, 1, '123')).rejects.toThrow(/phoneInvalid/)
    await expect(buy(tier.$id, 1, '0241234567', { email: 'nope' })).rejects.toThrow(/emailInvalid/)
    await expect(buy('missing', 1)).rejects.toThrow(/tierNotFound/)
    await updateTier(owner, tier.$id, { salesEnd: '2026-10-01T00:00:00Z' })
    await expect(buy(tier.$id, 1)).rejects.toThrow(/salesClosed/)
    await updateTier(owner, tier.$id, { salesEnd: null, status: 'hidden' })
    await expect(buy(tier.$id, 1)).rejects.toThrow(/tierHidden/)
    await updateTier(owner, tier.$id, { status: 'active' })
    await setEventStatus(owner, event.$id, 'draft')
    await expect(buy(tier.$id, 1)).rejects.toThrow(/salesClosed/)
    expect(fake.dump('payments')).toHaveLength(0)
  })

  test('availability counts sold tickets and recent pending payments', async () => {
    const { tier } = await seed()
    await buy(tier.$id, 2, '0241234567')
    await expect(buy(tier.$id, 2, '0551234567')).rejects.toThrow(/soldOut/)
    await expect(buy(tier.$id, 1, '0551234567')).resolves.toBeTruthy()
    await expect(buy(tier.$id, 1, '0201234567')).rejects.toThrow(/soldOut/)
  })
})

describe('ticket confirmation (rules 2, 4, 5)', () => {
  test("the provider's charge comes off the top of a ticket payment too (decision #36)", async () => {
    const { tier, event } = await seed()
    const { payment } = await buy(tier.$id, 2, '0241234567', { email: 'buyer@example.com' })
    await confirmPayment({ ...callbackFor(payment.providerReference), feePesewas: 195 })
    const row = await fake.getDocument('voteapp', 'payments', payment.$id)
    // 10000 gross - 195 = 9805, shared 10/90: 980 (rounded down) and 8825.
    expect([row.providerFee, row.platformFee, row.organizerNet]).toEqual([195, 980, 8825])
    expect(fake.dump('ledger_entries')[0]).toMatchObject({ type: 'ticket_credit', amount: 8825 })
    expect(await ticketFigures(owner, event.$id)).toMatchObject({
      gross: 10000,
      charges: 195,
      platformShare: 980,
      organizerShare: 8825,
    })
  })

  test('a conflict while the payment is still pending throws, so the provider retries', async () => {
    const { tier } = await seed()
    const { payment } = await buy(tier.$id, 2, '0241234567', { email: 'buyer@example.com' })
    // A stray row holding the first ticket's id: the confirmation collides, yet nothing was issued.
    await fake.createDocument('voteapp', 'tickets', ticketId(payment.$id, 0), { organizationId: 'org1' })

    await expect(confirmPayment(callbackFor(payment.providerReference))).rejects.toThrow()
    expect((await fake.getDocument('voteapp', 'payments', payment.$id)).status).toBe('pending')
    expect(fake.dump('ledger_entries')).toHaveLength(0)

    // Once the collision is gone, the provider's retry issues the tickets once.
    await fake.deleteDocument('voteapp', 'tickets', ticketId(payment.$id, 0))
    expect((await confirmPayment(callbackFor(payment.providerReference))).outcome).toBe('confirmed')
    expect(fake.dump('tickets')).toHaveLength(2)
    expect(fake.dump('ledger_entries')).toHaveLength(1)
  })

  test('a verified success issues one signed ticket per seat, bumps the counter and credits the ledger once', async () => {
    const { tier, event } = await seed()
    const { payment } = await buy(tier.$id, 2, '0241234567', { email: 'buyer@example.com' })
    const { outcome } = await confirmPayment(callbackFor(payment.providerReference))
    expect(outcome).toBe('confirmed')
    const tickets = fake.dump('tickets')
    expect(tickets).toHaveLength(2)
    expect(tickets.map((t) => t.$id).sort()).toEqual([ticketId(payment.$id, 0), ticketId(payment.$id, 1)])
    for (const t of tickets) {
      expect(t).toMatchObject({
        status: 'valid',
        organizationId: 'org1',
        eventId: event.$id,
        tierId: tier.$id,
        buyerPhone: '233241234567',
        buyerEmail: 'buyer@example.com',
      })
      expect(verifyTicketToken(t.qrToken as string)).toBe(t.$id)
    }
    expect((await fake.getDocument('voteapp', 'ticket_tiers', tier.$id)).quantitySold).toBe(2)
    const ledger = fake.dump('ledger_entries')
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ type: 'ticket_credit', amount: 9000, paymentId: payment.$id })
    expect(fake.dump('votes')).toHaveLength(0)

    expect((await confirmPayment(callbackFor(payment.providerReference))).outcome).toBe('duplicate')
    expect(fake.dump('tickets')).toHaveLength(2)
    expect((await fake.getDocument('voteapp', 'ticket_tiers', tier.$id)).quantitySold).toBe(2)

    const figures = await ticketFigures(owner, event.$id)
    expect(figures).toEqual({
      ticketsSold: 2,
      ticketsUsed: 0,
      gross: 10000,
      charges: 0,
      platformShare: 1000,
      organizerShare: 9000,
    })
    expect(await listTickets(otherOrg, event.$id)).toEqual([])
  })

  test('two concurrent confirmations issue the tickets once', async () => {
    const { tier } = await seed()
    const { payment } = await buy(tier.$id, 3)
    const results = await Promise.all([
      confirmPayment(callbackFor(payment.providerReference)),
      confirmPayment(callbackFor(payment.providerReference)),
    ])
    expect(results.map((r) => r.outcome).sort()).toEqual(['confirmed', 'duplicate'])
    expect(fake.dump('tickets')).toHaveLength(3)
    expect((await fake.getDocument('voteapp', 'ticket_tiers', tier.$id)).quantitySold).toBe(3)
  })

  test('a failed callback issues nothing; a mismatched amount issues nothing', async () => {
    const { tier } = await seed()
    const { payment } = await buy(tier.$id, 1)
    expect((await confirmPayment(callbackFor(payment.providerReference, 'failed'))).outcome).toBe('failed')
    const { payment: p2 } = await buy(tier.$id, 1, '0551234567')
    expect((await confirmPayment({ ...callbackFor(p2.providerReference), amountPesewas: 1 })).outcome).toBe('mismatch')
    expect(fake.dump('tickets')).toHaveLength(0)
  })

  test('an oversell by in-flight payments still issues the paid tickets and is audited', async () => {
    const { tier } = await seed()
    const { payment: a } = await buy(tier.$id, 2, '0241234567')
    await fake.updateDocument('voteapp', 'payments', a.$id, { $createdAt: '2026-10-13T00:00:00Z' })
    const { payment: b } = await buy(tier.$id, 2, '0551234567')
    await confirmPayment(callbackFor(a.providerReference))
    await confirmPayment(callbackFor(b.providerReference))
    expect(fake.dump('tickets')).toHaveLength(4)
    expect((await fake.getDocument('voteapp', 'ticket_tiers', tier.$id)).quantitySold).toBe(4)
    expect(fake.dump('audit_logs').some((l) => l.action === 'ticket.oversold')).toBe(true)
  })
})

describe('scanning (atomic valid → used)', () => {
  async function issued() {
    const { tier, event } = await seed()
    const { payment } = await buy(tier.$id, 2)
    await confirmPayment(callbackFor(payment.providerReference))
    const [t1, t2] = fake.dump('tickets')
    return { event, tier, t1, t2 }
  }

  test('admits once, then reports already used with who and when', async () => {
    const { event, t1 } = await issued()
    const first = await scanTicket(scanner, event.$id, t1.qrToken as string)
    expect(first.outcome).toBe('admitted')
    expect(first.outcome === 'admitted' && first.ticket).toMatchObject({ status: 'used', scannedBy: 'u_door' })
    const second = await scanTicket(scanner, event.$id, t1.qrToken as string)
    expect(second.outcome).toBe('alreadyUsed')
    expect(fake.dump('ticket_scans')).toHaveLength(1)
  })

  test('two simultaneous scans admit exactly once', async () => {
    const { event, t2 } = await issued()
    const results = await Promise.all([
      scanTicket(scanner, event.$id, t2.qrToken as string),
      scanTicket(owner, event.$id, t2.qrToken as string),
    ])
    expect(results.map((r) => r.outcome).sort()).toEqual(['admitted', 'alreadyUsed'])
    expect(fake.dump('ticket_scans')).toHaveLength(1)
    expect((await fake.getDocument('voteapp', 'tickets', t2.$id)).status).toBe('used')
  })

  test('refuses forged, foreign, wrong-event and cancelled tickets, and designers', async () => {
    const { event, t1, t2 } = await issued()
    expect((await scanTicket(scanner, event.$id, 'nonsense')).outcome).toBe('invalid')
    expect((await scanTicket(scanner, event.$id, `${t1.$id}.AAAAAAAAAAAAAAAAAAAAAA`)).outcome).toBe('invalid')
    expect((await scanTicket(otherOrg, event.$id, t1.qrToken as string)).outcome).toBe('invalid')
    expect((await scanTicket(scanner, 'other_event', t1.qrToken as string)).outcome).toBe('wrongEvent')
    await fake.updateDocument('voteapp', 'tickets', t2.$id, { status: 'cancelled' })
    expect((await scanTicket(scanner, event.$id, t2.qrToken as string)).outcome).toBe('cancelled')
    await expect(scanTicket(designer, event.$id, t1.qrToken as string)).rejects.toBeInstanceOf(ForbiddenError)
    expect(fake.dump('ticket_scans')).toHaveLength(0)
  })

  test('a token signed under a rotated secret is dead even if well-formed', async () => {
    const { event, t1 } = await issued()
    process.env.TICKET_SECRET = 'n'.repeat(32)
    const { signTicketToken } = await import('../tickets/token')
    expect((await scanTicket(scanner, event.$id, signTicketToken(t1.$id as string))).outcome).toBe('invalid')
  })
})

describe('buyerTickets (the buyer page poll)', () => {
  test("needs the buyer's key: one ticket's payment id does not unlock its siblings", async () => {
    const { tier } = await seed()
    const { payment } = await buy(tier.$id, 2)
    const key = paymentAccessKey(payment.$id)

    // Before confirmation: the status, no tickets.
    expect(await buyerTickets(payment.$id, key)).toEqual({ status: 'pending', tierName: '', tickets: [] })

    await confirmPayment(callbackFor(payment.providerReference))
    const out = await buyerTickets(payment.$id, key)
    expect(out?.status).toBe('success')
    expect(out?.tierName).toBe('Regular')
    expect(out?.tickets.map((t) => t.id).sort()).toEqual([ticketId(payment.$id, 0), ticketId(payment.$id, 1)])

    // Someone holding ticket 0 knows the payment id, but not the key.
    const [, paymentIdFromTicket] = /^tk_(.+)_\d+$/.exec(ticketId(payment.$id, 0))!
    expect(await buyerTickets(paymentIdFromTicket, null)).toBeNull()
    const ticketSig = out!.tickets[0].token.split('.')[1]
    expect(await buyerTickets(paymentIdFromTicket, ticketSig)).toBeNull()
    expect(await buyerTickets(paymentIdFromTicket, 'x'.repeat(22))).toBeNull()
  })

  test("another purchase's key does not open this one, and vote payments are never listed", async () => {
    const { tier } = await seed()
    const a = await buy(tier.$id, 1, '0241234567')
    const b = await buy(tier.$id, 1, '0241234568')
    expect(await buyerTickets(a.payment.$id, paymentAccessKey(b.payment.$id))).toBeNull()

    fake.seed('payments', { $id: 'pay_vote', purpose: 'vote', status: 'success', organizationId: 'org1' })
    expect(await buyerTickets('pay_vote', paymentAccessKey('pay_vote'))).toBeNull()
  })
})
