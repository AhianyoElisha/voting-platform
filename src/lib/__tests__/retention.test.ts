import { beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import { maskPhone } from '../phone'
import { ERASED, erasePersonalData, eventClosedAt, isDueForErasure, redactRawCallback } from '../retention-server'

process.env.APPWRITE_DATABASE_ID = 'voteapp'
const DAY = 24 * 60 * 60 * 1000
const CLOSED = '2026-08-01T12:00:00.000Z'
const at = (days: number) => new Date(Date.parse(CLOSED) + days * DAY)

const paystackWebhook = JSON.stringify({
  event: 'charge.success',
  data: {
    id: 4099,
    reference: 'pay_1',
    status: 'success',
    amount: 1000,
    fees: 20,
    currency: 'GHS',
    channel: 'mobile_money',
    gateway_response: 'Approved for 0241234567',
    customer: { id: 77, email: 'pay_1@voteapp.test', phone: '0241234567', first_name: 'Ama' },
    authorization: { bank: 'MTN', mobile_money_number: '0241234567', account_name: 'Ama Owusu' },
    metadata: { payerName: 'Ama Owusu' },
  },
})

function seedEvent(id: string, fields: Record<string, unknown> = {}) {
  fake.seed('events', {
    $id: id,
    organizationId: 'org1',
    status: 'closed',
    endsAt: '2026-07-31T00:00:00.000Z',
    closedAt: CLOSED,
    personalDataErasedAt: null,
    $updatedAt: CLOSED,
    ...fields,
  })
}

function seedPayment(id: string, eventId: string, fields: Record<string, unknown> = {}) {
  fake.seed('payments', {
    $id: id,
    organizationId: 'org1',
    eventId,
    status: 'success',
    amount: 1000,
    quantity: 10,
    payerPhone: '233241234567',
    payerEmail: 'buyer@example.com',
    payerName: 'Ama Owusu',
    providerReference: `ref_${id}`,
    rawCallback: paystackWebhook,
    ...fields,
  })
}

beforeEach(() => {
  fake = createFakeDatabases(UNIQUE_INDEXES)
})

describe('redactRawCallback', () => {
  test('keeps what a money dispute needs and drops everything that identifies the payer', () => {
    const out = redactRawCallback(paystackWebhook)!
    expect(JSON.parse(out)).toEqual({
      _redacted: true,
      event: 'charge.success',
      data: {
        id: 4099,
        reference: 'pay_1',
        status: 'success',
        amount: 1000,
        fees: 20,
        currency: 'GHS',
        channel: 'mobile_money',
        customer: { id: 77 },
      },
    })
    expect(out).not.toMatch(/0241234567|Ama|@/)
  })

  test('null stays null; non-JSON keeps nothing; redacting twice changes nothing', () => {
    expect(redactRawCallback(null)).toBeNull()
    expect(JSON.parse(redactRawCallback('phone 0241234567')!)).toEqual({ _redacted: true })
    const once = redactRawCallback(paystackWebhook)
    expect(redactRawCallback(once)).toBe(once)
  })
})

describe('when an event is due', () => {
  test('90 days after closedAt, never before, and only once', () => {
    const event = {
      status: 'closed' as const,
      closedAt: CLOSED,
      endsAt: CLOSED,
      $updatedAt: CLOSED,
      personalDataErasedAt: null,
    }
    expect(isDueForErasure(event, at(89.9))).toBe(false)
    expect(isDueForErasure(event, at(90))).toBe(true)
    expect(isDueForErasure({ ...event, personalDataErasedAt: at(90).toISOString() }, at(91))).toBe(false)
    expect(isDueForErasure({ ...event, status: 'live' as never }, at(200))).toBe(false)
  })

  test('without closedAt, the later of the end time and the last update, so nothing goes early', () => {
    expect(
      eventClosedAt({ closedAt: null, endsAt: '2026-08-10T00:00:00.000Z', $updatedAt: CLOSED }).toISOString()
    ).toBe('2026-08-10T00:00:00.000Z')
    expect(
      eventClosedAt({ closedAt: null, endsAt: '2026-07-01T00:00:00.000Z', $updatedAt: CLOSED }).toISOString()
    ).toBe(CLOSED)
  })
})

describe('erasePersonalData', () => {
  test('erases payers and buyers of due events, keeps the money, marks and audits the event', async () => {
    seedEvent('ev_due')
    seedPayment('p1', 'ev_due')
    seedPayment('p2', 'ev_due', { status: 'pending', payerEmail: null, payerName: null, rawCallback: null })
    fake.seed('tickets', {
      $id: 'tk_p1_0',
      organizationId: 'org1',
      eventId: 'ev_due',
      paymentId: 'p1',
      buyerName: 'Ama Owusu',
      buyerPhone: '233241234567',
      buyerEmail: 'buyer@example.com',
      status: 'used',
      qrToken: 'tok',
    })

    const totals = await erasePersonalData({ now: at(91) })
    expect(totals).toMatchObject({ events: 1, payments: 2, tickets: 1 })

    const p1 = fake.dump('payments').find((p) => p.$id === 'p1')!
    expect(p1).toMatchObject({ payerPhone: ERASED, payerEmail: null, payerName: null, amount: 1000, quantity: 10 })
    expect(p1).toMatchObject({ status: 'success', providerReference: 'ref_p1' })
    expect(String(p1.rawCallback)).not.toMatch(/0241234567|Ama|@/)
    expect(fake.dump('tickets')[0]).toMatchObject({
      buyerPhone: ERASED,
      buyerName: null,
      buyerEmail: null,
      status: 'used',
      qrToken: 'tok',
    })
    expect(fake.dump('events')[0].personalDataErasedAt).toBe(at(91).toISOString())
    const audit = fake.dump('audit_logs')
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'event.personal_data_erased', actorId: 'system', organizationId: 'org1' })
    expect(maskPhone(String(p1.payerPhone))).toBe('')
  })

  test('leaves events that are not due, not closed or already erased untouched', async () => {
    seedEvent('ev_recent', { closedAt: at(30).toISOString() })
    seedEvent('ev_live', { status: 'live', closedAt: null })
    seedEvent('ev_done', { personalDataErasedAt: at(95).toISOString() })
    for (const ev of ['ev_recent', 'ev_live', 'ev_done']) seedPayment(`p_${ev}`, ev)

    expect(await erasePersonalData({ now: at(100) })).toMatchObject({ events: 0, payments: 0, tickets: 0 })
    for (const p of fake.dump('payments')) expect(p.payerPhone).toBe('233241234567')
    expect(fake.dump('audit_logs')).toHaveLength(0)
  })

  test('another organization’s rows sharing nothing but the job are not touched', async () => {
    seedEvent('ev_due')
    seedPayment('p_other', 'ev_due', { organizationId: 'org2' })
    await erasePersonalData({ now: at(91) })
    expect(fake.dump('payments')[0].payerPhone).toBe('233241234567')
  })

  test('pages past the first hundred rows', async () => {
    seedEvent('ev_due')
    for (let i = 0; i < 230; i++) seedPayment(`p${String(i).padStart(3, '0')}`, 'ev_due')
    expect((await erasePersonalData({ now: at(91) })).payments).toBe(230)
    expect(fake.dump('payments').every((p) => p.payerPhone === ERASED)).toBe(true)
  })

  test('a run that fails partway leaves the event unmarked, and the next run finishes it', async () => {
    seedEvent('ev_due')
    seedPayment('p1', 'ev_due')
    seedPayment('p2', 'ev_due')
    const update = fake.updateDocument.bind(fake)
    let calls = 0
    const spy = vi.spyOn(fake, 'updateDocument').mockImplementation(async (...args: Parameters<typeof update>) => {
      if (args[1] === 'payments' && ++calls === 2) throw new Error('network')
      return update(...args)
    })
    await expect(erasePersonalData({ now: at(91) })).rejects.toThrow('network')
    spy.mockRestore()
    expect(fake.dump('events')[0].personalDataErasedAt).toBeNull()

    // The finished row is skipped; only the other one is written.
    expect(await erasePersonalData({ now: at(92) })).toMatchObject({ events: 1, payments: 1 })
    expect(fake.dump('payments').every((p) => p.payerPhone === ERASED)).toBe(true)
  })

  test('deletes USSD session rows a day after they expired', async () => {
    const now = at(0)
    fake.seed('ussd_sessions', {
      $id: 'old',
      phone: '233241234567',
      expiresAt: new Date(now.getTime() - 2 * DAY).toISOString(),
    })
    fake.seed('ussd_sessions', {
      $id: 'fresh',
      phone: '233241234567',
      expiresAt: new Date(now.getTime() - 60_000).toISOString(),
    })
    expect((await erasePersonalData({ now })).ussdSessions).toBe(1)
    expect(fake.dump('ussd_sessions').map((s) => s.$id)).toEqual(['fresh'])
  })
})
