import crypto from 'crypto'
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
import { PaymentProviderNotConfiguredError, getPaymentProvider } from '../payments'
import { handleProviderCallback } from '../payments/callback'
import { PaystackPaymentProvider } from '../payments/paystack'
import { PaystackClient, type FetchLike } from '../payments/paystack/client'
import { PaystackConfigError, loadPaystackConfig, type PaystackConfig } from '../payments/paystack/config'
import { localPhone, providerForMsisdn, verdictFor, verifySignature } from '../payments/paystack/parse'
import { resetRateLimits } from '../rate-limit'
import { VoteError, initiateVotePayment, reconcilePendingPayments, submitPaymentOtp } from '../votes-server'

const SECRET = 'sk_test_abc123'
const cfg: PaystackConfig = {
  secretKey: SECRET,
  baseUrl: 'https://paystack.example',
  customerEmailDomain: 'voters.example.com',
  callbackIps: [],
  timeoutMs: 1000,
}

type Call = { url: string; init: RequestInit }

function stubFetch(answer: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, init }
    calls.push(call)
    const { status = 200, body } = answer(call)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  return { calls, fetchImpl }
}

function providerWith(
  answer: (call: Call) => { status?: number; body: unknown },
  overrides: Partial<PaystackConfig> = {}
) {
  const stub = stubFetch(answer)
  const c = { ...cfg, ...overrides }
  return {
    provider: new PaystackPaymentProvider(c, new PaystackClient(c, stub.fetchImpl, async () => {})),
    calls: stub.calls,
  }
}

const sign = (body: string, key = SECRET) => crypto.createHmac('sha512', key).update(body).digest('hex')

function webhook(reference: string, over: Record<string, unknown> = {}, event = 'charge.success') {
  const body = JSON.stringify({
    event,
    data: {
      reference,
      status: 'success',
      amount: 1500,
      currency: 'GHS',
      channel: 'mobile_money',
      authorization: { bank: 'MTN', channel: 'mobile_money' },
      ...over,
    },
  })
  return { body, headers: new Headers({ 'x-paystack-signature': sign(body) }) }
}

const verifyBody = (reference: string, status: string, over: Record<string, unknown> = {}) => ({
  status: true,
  message: 'Verification successful',
  data: { reference, status, amount: 1500, currency: 'GHS', authorization: { bank: 'MTN' }, ...over },
})

describe('loadPaystackConfig', () => {
  test('needs a secret key and a customer email domain', () => {
    expect(() => loadPaystackConfig({})).toThrow(PaystackConfigError)
    expect(() => loadPaystackConfig({ PAYSTACK_SECRET_KEY: 'pk_test_public' })).toThrow(/secret key/)
    expect(() =>
      loadPaystackConfig({ PAYSTACK_SECRET_KEY: SECRET, NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
    ).toThrow(/PAYSTACK_CUSTOMER_EMAIL_DOMAIN/)
    expect(
      loadPaystackConfig({ PAYSTACK_SECRET_KEY: SECRET, NEXT_PUBLIC_APP_URL: 'https://vote.example.com/' })
        .customerEmailDomain
    ).toBe('vote.example.com')
    const full = loadPaystackConfig({
      PAYSTACK_SECRET_KEY: SECRET,
      PAYSTACK_CUSTOMER_EMAIL_DOMAIN: 'voters.example.com',
      PAYSTACK_CALLBACK_IPS: '52.31.139.75, 52.49.173.169',
    })
    expect(full).toMatchObject({ baseUrl: 'https://api.paystack.co', callbackIps: ['52.31.139.75', '52.49.173.169'] })
  })

  test('getPaymentProvider reports a missing key as not configured', () => {
    const saved = process.env.PAYSTACK_SECRET_KEY
    delete process.env.PAYSTACK_SECRET_KEY
    expect(() => getPaymentProvider('paystack')).toThrow(PaymentProviderNotConfiguredError)
    if (saved !== undefined) process.env.PAYSTACK_SECRET_KEY = saved
  })
})

describe('parse helpers', () => {
  test('network and phone format', () => {
    expect(providerForMsisdn('233241234567')).toBe('mtn')
    expect(providerForMsisdn('233201234567')).toBe('vod')
    expect(providerForMsisdn('233271234567')).toBe('atl')
    expect(providerForMsisdn('233311234567')).toBeNull()
    expect(localPhone('233241234567')).toBe('0241234567')
  })

  test('signature: right key passes; wrong key, tampering and junk fail', () => {
    const body = '{"event":"charge.success"}'
    expect(verifySignature(body, sign(body), SECRET)).toBe(true)
    expect(verifySignature(body, sign(body, 'sk_test_other'), SECRET)).toBe(false)
    expect(verifySignature(body + ' ', sign(body), SECRET)).toBe(false)
    expect(verifySignature(body, 'abc', SECRET)).toBe(false)
    expect(verifySignature(body, null, SECRET)).toBe(false)
  })

  test('verdicts', () => {
    expect(verdictFor('success')).toBe('success')
    for (const s of ['failed', 'abandoned', 'reversed']) expect(verdictFor(s)).toBe('failed')
    for (const s of ['ongoing', 'pending', 'processing', 'queued', 'send_otp', 'pay_offline'])
      expect(verdictFor(s)).toBe('pending')
    expect(verdictFor('something_new')).toBe('unknown')
  })
})

describe('initiate', () => {
  test('charges the payer in pesewas with our payment id as the reference and no personal email', async () => {
    const { provider, calls } = providerWith(() => ({
      body: {
        status: true,
        message: 'Charge attempted',
        data: { reference: 'pay1', status: 'pay_offline', display_text: 'Approve on your phone' },
      },
    }))
    const out = await provider.initiate({
      paymentId: 'pay1',
      amount: 1500,
      payerPhone: '233241234567',
      description: '10 votes',
    })
    expect(out).toEqual({ providerReference: 'pay1', instructions: 'Approve on your phone' })
    expect(calls[0].url).toBe('https://paystack.example/charge')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`)
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      email: 'pay1@voters.example.com',
      amount: 1500,
      currency: 'GHS',
      reference: 'pay1',
      mobile_money: { phone: '0241234567', provider: 'mtn' },
    })
  })

  test('send_otp asks for the code', async () => {
    const { provider } = providerWith(() => ({
      body: { status: true, data: { reference: 'pay1', status: 'send_otp' } },
    }))
    const out = await provider.initiate({
      paymentId: 'pay1',
      amount: 100,
      payerPhone: '233201234567',
      description: 'x',
    })
    expect(out.nextAction).toBe('otp')
  })

  test('a refusal throws, and an unsupported network never calls Paystack', async () => {
    const refused = providerWith(() => ({ status: 400, body: { status: false, message: 'Invalid phone' } }))
    await expect(
      refused.provider.initiate({ paymentId: 'p', amount: 100, payerPhone: '233241234567', description: 'x' })
    ).rejects.toThrow(/Invalid phone/)
    const failed = providerWith(() => ({
      body: { status: true, data: { reference: 'p', status: 'failed', gateway_response: 'Declined' } },
    }))
    await expect(
      failed.provider.initiate({ paymentId: 'p', amount: 100, payerPhone: '233241234567', description: 'x' })
    ).rejects.toThrow(/Declined/)
    const unsupported = providerWith(() => ({ body: {} }))
    await expect(
      unsupported.provider.initiate({ paymentId: 'p', amount: 100, payerPhone: '233311234567', description: 'x' })
    ).rejects.toThrow(/unsupported/)
    expect(unsupported.calls).toHaveLength(0)
  })
})

describe('verifyCallback (rule 2: signed webhooks only)', () => {
  const { provider } = providerWith(() => ({ body: {} }))

  test('a signed charge.success is a success with the amount and network', async () => {
    const { body, headers } = webhook('pay1')
    expect(await provider.verifyCallback(headers, body)).toMatchObject({
      provider: 'paystack',
      providerReference: 'pay1',
      clientReference: 'pay1',
      status: 'success',
      amountPesewas: 1500,
      network: 'MTN',
    })
  })

  test('unsigned, mis-signed, non-GHS or non-success payloads are rejected', async () => {
    const { body } = webhook('pay1')
    expect(await provider.verifyCallback(new Headers(), body)).toBeNull()
    expect(
      await provider.verifyCallback(new Headers({ 'x-paystack-signature': sign(body, 'sk_test_x') }), body)
    ).toBeNull()
    const usd = webhook('pay1', { currency: 'USD' })
    expect(await provider.verifyCallback(usd.headers, usd.body)).toBeNull()
    const noAmount = webhook('pay1', { amount: null })
    expect(await provider.verifyCallback(noAmount.headers, noAmount.body)).toBeNull()
    const junk = 'null'
    expect(await provider.verifyCallback(new Headers({ 'x-paystack-signature': sign(junk) }), junk)).toBeNull()
    const notPaid = webhook('pay1', { status: 'failed' })
    expect(await provider.verifyCallback(notPaid.headers, notPaid.body)).toBeNull()
  })

  test('other signed events are acknowledged and ignored', async () => {
    const { body, headers } = webhook('trf1', {}, 'transfer.success')
    expect(await provider.verifyCallback(headers, body)).toBe('ignored')
  })

  test('the optional IP allowlist is enforced on top of the signature', async () => {
    const strict = providerWith(() => ({ body: {} }), { callbackIps: ['52.31.139.75'] }).provider
    const { body, headers } = webhook('pay1')
    expect(await strict.verifyCallback(headers, body)).toBeNull()
    headers.set('x-forwarded-for', '52.31.139.75')
    expect(await strict.verifyCallback(headers, body)).not.toBeNull()
  })
})

describe('verify (reconciliation)', () => {
  test('success and failure are final; in-flight and unknown references are not', async () => {
    const answers: Record<string, unknown> = {
      ok: verifyBody('ok', 'success'),
      gone: verifyBody('gone', 'abandoned'),
      wait: verifyBody('wait', 'ongoing'),
      other: verifyBody('someone-else', 'success'),
      missing: { status: false, message: 'Transaction reference not found' },
    }
    const { provider, calls } = providerWith((call) => {
      const ref = call.url.split('/').pop()!
      return { status: ref === 'missing' ? 400 : 200, body: answers[ref] }
    })
    expect(await provider.verifiedResult('ok')).toMatchObject({ status: 'success', amountPesewas: 1500 })
    expect(await provider.verifiedResult('gone')).toMatchObject({ status: 'failed' })
    expect(await provider.verifiedResult('wait')).toBeNull()
    expect(await provider.verifiedResult('other')).toBeNull()
    expect(await provider.verifiedResult('missing')).toBeNull()
    expect(await provider.checkStatus({ providerReference: 'wait', clientReference: 'wait' })).toBe('pending')
    expect(calls[0].url).toBe('https://paystack.example/transaction/verify/ok')
  })
})

// ─── Through the real pipeline, against the in-memory database ─────────

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const NOW = new Date('2026-11-10T12:00:00Z')
// The fake database stamps rows from 2026-10-14T00:00Z; codes are checked against that.
const SOON_AFTER_CREATE = new Date('2026-10-14T00:05:00Z')

async function seedLiveEvent() {
  const { event } = await createEvent(owner, {
    title: 'Faculty Awards',
    votePriceCedis: '1.50',
    startsAt: '2026-11-01T00:00:00Z',
    endsAt: '2026-11-30T00:00:00Z',
    resultsVisibility: 'count',
  })
  const category = await createCategory(owner, event.$id, 'Most Influential')
  const { nominee } = await createNominee(owner, { eventId: event.$id, categoryId: category.$id, name: 'Ama Owusu' })
  await setEventStatus(owner, event.$id, 'live')
  return { nominee }
}

describe('pipeline with Paystack', () => {
  beforeEach(() => {
    process.env.APPWRITE_DATABASE_ID = 'voteapp'
    process.env.PLATFORM_COMMISSION_BPS = '1000'
    fake = createFakeDatabases(UNIQUE_INDEXES)
    fake.seed('organizations', { $id: 'org1', name: 'Org 1', slug: 'org-1', status: 'active', commissionRate: null })
    resetRateLimits()
  })
  afterEach(() => {
    delete process.env.PLATFORM_COMMISSION_BPS
  })

  test('a signed webhook counts the votes once; a replay is a duplicate', async () => {
    const { nominee } = await seedLiveEvent()
    const { provider } = providerWith(() => ({
      body: { status: true, data: { reference: 'x', status: 'pay_offline' } },
    }))
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 10, phone: '0241234567' },
      { provider, now: NOW }
    )
    expect(payment.providerReference).toBe(payment.$id)

    const { body, headers } = webhook(payment.$id)
    const first = await handleProviderCallback(provider, headers, body)
    expect(first).toMatchObject({ ok: true, outcome: 'confirmed' })
    const again = await handleProviderCallback(provider, headers, body)
    expect(again).toMatchObject({ ok: true, outcome: 'duplicate' })
    expect(fake.dump('votes')).toHaveLength(1)
    expect(fake.dump('payments')[0]).toMatchObject({ status: 'success', network: 'MTN' })

    const forged = webhook(payment.$id)
    expect(await handleProviderCallback(provider, new Headers(), forged.body)).toMatchObject({ ok: false, status: 400 })
  })

  test('a wrong amount is never credited', async () => {
    const { nominee } = await seedLiveEvent()
    const { provider } = providerWith(() => ({
      body: { status: true, data: { reference: 'x', status: 'pay_offline' } },
    }))
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 10, phone: '0241234567' },
      { provider, now: NOW }
    )
    const { body, headers } = webhook(payment.$id, { amount: 150 })
    await handleProviderCallback(provider, headers, body)
    expect(fake.dump('votes')).toHaveLength(0)
  })

  test('the one-time code continues the charge but confirms nothing', async () => {
    const { nominee } = await seedLiveEvent()
    const { provider, calls } = providerWith((call) =>
      call.url.endsWith('/charge')
        ? { body: { status: true, data: { reference: 'x', status: 'send_otp' } } }
        : { body: { status: true, data: { reference: 'x', status: 'pay_offline' } } }
    )
    const started = await initiateVotePayment(
      { code: nominee.code, quantity: 1, phone: '0201234567' },
      { provider, now: NOW }
    )
    expect(started.nextAction).toBe('otp')
    await expect(submitPaymentOtp(started.payment.$id, 'abc', { provider })).rejects.toThrow(VoteError)
    const out = await submitPaymentOtp(started.payment.$id, '123456', { provider, now: SOON_AFTER_CREATE })
    expect(out.nextAction).toBeUndefined()
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ reference: started.payment.$id, otp: '123456' })
    expect(fake.dump('payments')[0].status).toBe('pending')
    expect(fake.dump('votes')).toHaveLength(0)
  })

  test('a code is refused once the payment is settled or too old', async () => {
    const { nominee } = await seedLiveEvent()
    const { provider } = providerWith(() => ({ body: { status: true, data: { reference: 'x', status: 'send_otp' } } }))
    const { payment } = await initiateVotePayment(
      { code: nominee.code, quantity: 1, phone: '0201234567' },
      { provider, now: NOW }
    )
    const late = new Date('2026-10-14T01:00:00Z')
    await expect(submitPaymentOtp(payment.$id, '123456', { provider, now: late })).rejects.toThrow(/paymentNotPending/)
  })

  test('reconciliation fails an abandoned charge and confirms a paid one', async () => {
    const { nominee } = await seedLiveEvent()
    const charge = { body: { status: true, data: { reference: 'x', status: 'pay_offline' } } }
    let verdicts: Record<string, string> = {}
    const { provider } = providerWith((call) => {
      if (call.url.endsWith('/charge')) return charge
      const ref = call.url.split('/').pop()!
      return { body: verifyBody(ref, verdicts[ref]) }
    })
    const a = await initiateVotePayment(
      { code: nominee.code, quantity: 10, phone: '0241234567' },
      { provider, now: NOW }
    )
    const b = await initiateVotePayment(
      { code: nominee.code, quantity: 10, phone: '0551234567' },
      { provider, now: NOW }
    )
    verdicts = { [a.payment.$id]: 'success', [b.payment.$id]: 'abandoned' }
    const totals = await reconcilePendingPayments({ provider, olderThanMs: -60_000 })
    expect(totals).toMatchObject({ confirmed: 1, failed: 1 })
    expect(fake.dump('votes')).toHaveLength(1)
  })
})
