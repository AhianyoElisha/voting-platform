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
import { MockPaymentProvider } from '../payments/mock'
import type { PaymentProvider } from '../payments/provider'
import { resetRateLimits } from '../rate-limit'
import { handleUssd } from '../ussd/handler'
import { buildHubtelUssdResponse, parseHubtelUssdRequest } from '../ussd/hubtel'
import { MESSAGES } from '../ussd/menu'
import { USSD_SESSION_TTL_MS } from '../ussd/session'

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const NOW = new Date('2026-11-10T12:00:00Z')
const provider = new MockPaymentProvider()

async function seedLiveEvent() {
  const { event, round } = await createEvent(owner, {
    title: 'Faculty Awards',
    votePriceCedis: '1.50',
    startsAt: '2026-11-01T00:00:00Z',
    endsAt: '2026-11-30T00:00:00Z',
    resultsVisibility: 'count',
  })
  const category = await createCategory(owner, event.$id, 'Miss Social Science')
  const { nominee } = await createNominee(owner, { eventId: event.$id, categoryId: category.$id, name: 'Ama Owusu' })
  await setEventStatus(owner, event.$id, 'live')
  return { event, round, category, nominee }
}

const dial = (sessionId: string, phone = '0241234567') =>
  handleUssd({ sessionId, phone, text: '', type: 'initiation', network: 'MTN' }, { now: NOW, provider })
const reply = (sessionId: string, text: string, phone = '0241234567') =>
  handleUssd({ sessionId, phone, text, type: 'response' }, { now: NOW, provider })

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  process.env.MOCK_PAYMENT_SECRET = 's'
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
})

describe('handleUssd', () => {
  test('happy path creates exactly one pending payment for the dialling number on the live round', async () => {
    const { nominee, round, event } = await seedLiveEvent()
    expect(await dial('s1')).toEqual({ message: MESSAGES.main, end: false })
    expect(await reply('s1', '1')).toEqual({ message: MESSAGES.enterCode, end: false })
    const shown = await reply('s1', nominee.code)
    expect(shown.message).toBe(`Miss Social Science\nAma Owusu\nGHS 1.50 per vote\n${MESSAGES.enterQuantity}`)
    const confirm = await reply('s1', '4')
    expect(confirm.message).toBe('Pay GHS 6.00 for 4 votes for Ama Owusu?\n1. Confirm\n2. Cancel')
    expect(fake.dump('payments')).toHaveLength(0)

    const done = await reply('s1', '1')
    expect(done).toEqual({ message: MESSAGES.sent, end: true })
    const payments = fake.dump('payments')
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({
      status: 'pending',
      channel: 'ussd',
      payerPhone: '233241234567',
      quantity: 4,
      amount: 600,
      roundId: round.$id,
      eventId: event.$id,
      nomineeId: nominee.$id,
      organizationId: 'org1',
    })
    expect(fake.dump('votes')).toHaveLength(0)
    const session = fake.dump('ussd_sessions')[0]
    expect(session.status).toBe('released')
    expect(session.lastStep).toBe('done')
  })

  test('cancel never creates a payment', async () => {
    const { nominee } = await seedLiveEvent()
    await dial('s2')
    await reply('s2', '1')
    await reply('s2', nominee.code)
    await reply('s2', '2')
    expect(await reply('s2', '2')).toEqual({ message: MESSAGES.cancelled, end: true })
    expect(fake.dump('payments')).toHaveLength(0)
  })

  test('a paused event never reaches initiation', async () => {
    const { nominee, event } = await seedLiveEvent()
    await setEventStatus(owner, event.$id, 'paused')
    await dial('s3')
    await reply('s3', '1')
    expect(await reply('s3', nominee.code)).toEqual({ message: MESSAGES.notOpen, end: true })
    expect(fake.dump('payments')).toHaveLength(0)
  })

  test('wrong codes re-ask, and the session carries on', async () => {
    const { nominee } = await seedLiveEvent()
    await dial('s4')
    await reply('s4', '1')
    expect(await reply('s4', '9999')).toEqual({ message: MESSAGES.noNominee, end: false })
    expect(await reply('s4', 'ab')).toEqual({ message: MESSAGES.invalidCode, end: false })
    expect((await reply('s4', nominee.code)).message).toContain('Ama Owusu')
  })

  test('a provider failure ends the session with no pending payment left behind', async () => {
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
    await dial('s5')
    await reply('s5', '1')
    await reply('s5', nominee.code)
    await reply('s5', '2')
    const out = await handleUssd(
      { sessionId: 's5', phone: '0241234567', text: '1', type: 'response' },
      { now: NOW, provider: broken }
    )
    expect(out).toEqual({ message: MESSAGES.paymentFailed, end: true })
    expect(fake.dump('payments').map((p) => p.status)).toEqual(['failed'])
  })

  test('the phone always comes from the aggregator, and an unusable number is refused at confirmation', async () => {
    const { nominee } = await seedLiveEvent()
    await dial('s6', '+1 555 0100')
    await reply('s6', '1', '+1 555 0100')
    await reply('s6', nominee.code, '+1 555 0100')
    await reply('s6', '1', '+1 555 0100')
    expect(await reply('s6', '1', '+1 555 0100')).toEqual({ message: MESSAGES.phoneInvalid, end: true })
    expect(fake.dump('payments')).toHaveLength(0)
  })

  test('an expired or released session starts over; timeout and release close it', async () => {
    const { nominee } = await seedLiveEvent()
    await dial('s7')
    await reply('s7', '1')
    const later = new Date(NOW.getTime() + USSD_SESSION_TTL_MS + 1000)
    const out = await handleUssd(
      { sessionId: 's7', phone: '0241234567', text: nominee.code, type: 'response' },
      { now: later, provider }
    )
    // Started over: the code was taken as a main-menu choice.
    expect(out.message).toBe(MESSAGES.invalidChoice)

    await handleUssd({ sessionId: 's7', phone: '0241234567', text: '', type: 'timeout' })
    expect(fake.dump('ussd_sessions').find((s) => s.sessionId === 's7')?.status).toBe('released')
    expect(await handleUssd({ sessionId: 'never', phone: '0241234567', text: '', type: 'release' })).toEqual({
      message: '',
      end: true,
    })
  })

  test('a number over its initiation budget is told to wait, with no payment created', async () => {
    const { nominee } = await seedLiveEvent()
    for (let i = 0; i < 6; i++) {
      await dial(`b${i}`)
      await reply(`b${i}`, '1')
      await reply(`b${i}`, nominee.code)
      await reply(`b${i}`, '1')
      expect(await reply(`b${i}`, '1')).toEqual({ message: MESSAGES.sent, end: true })
    }
    await dial('b7')
    await reply('b7', '1')
    await reply('b7', nominee.code)
    await reply('b7', '1')
    expect(await reply('b7', '1')).toEqual({ message: MESSAGES.tooMany, end: true })
    expect(fake.dump('payments')).toHaveLength(6)
  })

  test('dialling again reuses the session row for that id', async () => {
    await seedLiveEvent()
    await dial('s8')
    await reply('s8', '3')
    await dial('s8')
    expect(fake.dump('ussd_sessions').filter((s) => s.sessionId === 's8')).toHaveLength(1)
  })
})

describe('Hubtel USSD transport', () => {
  test('parses initiation, response, timeout and release', () => {
    expect(
      parseHubtelUssdRequest({
        Type: 'Initiation',
        Mobile: '233241234567',
        SessionId: 'abc',
        ServiceCode: '711*10',
        Message: '*711*10#',
        Operator: 'MTN',
        Sequence: 1,
      })
    ).toEqual({
      sessionId: 'abc',
      phone: '233241234567',
      network: 'MTN',
      text: '',
      type: 'initiation',
    })
    expect(
      parseHubtelUssdRequest({ type: 'response', mobile: '233241234567', sessionId: 'abc', message: '1', sequence: 2 })
    ).toMatchObject({ text: '1', type: 'response' })
    expect(parseHubtelUssdRequest({ Type: 'Timeout', Mobile: '233241234567', SessionId: 'abc' })?.type).toBe('timeout')
    expect(parseHubtelUssdRequest({ Type: 'Release', Mobile: '233241234567', SessionId: 'abc' })?.type).toBe('release')
    expect(parseHubtelUssdRequest({ Type: 'Weird', Mobile: 'x', SessionId: 'abc' })).toBeNull()
    expect(parseHubtelUssdRequest({ Type: 'Response', SessionId: 'abc' })).toBeNull()
    expect(parseHubtelUssdRequest('junk')).toBeNull()
  })

  test('builds Response while the session continues and Release when it ends', () => {
    expect(buildHubtelUssdResponse('abc', { message: 'Enter nominee code:', end: false })).toEqual({
      SessionId: 'abc',
      Type: 'Response',
      Message: 'Enter nominee code:',
      Label: 'voteapp',
      ClientState: '',
      DataType: 'input',
      FieldType: 'text',
    })
    expect(buildHubtelUssdResponse('abc', { message: 'Bye', end: true })).toMatchObject({
      Type: 'Release',
      DataType: 'display',
    })
  })
})
