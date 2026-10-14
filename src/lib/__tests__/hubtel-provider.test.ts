import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PaymentProviderNotConfiguredError, getPaymentProvider } from '../payments'
import { HubtelPaymentProvider } from '../payments/hubtel'
import { HubtelClient, HubtelHttpError } from '../payments/hubtel/client'
import { HubtelConfigError, loadHubtelConfig, type HubtelConfig } from '../payments/hubtel/config'

const cfg: HubtelConfig = {
  clientId: 'id',
  clientSecret: 'secret',
  merchantAccount: 'HM123',
  receiveUrl: 'https://rmp.example/merchants/HM123/receive/mobilemoney',
  statusUrl: 'https://status.example/transactions/HM123/status',
  payloadShape: 'nested',
  callbackUrl: 'https://vote.example/api/payments/callback/hubtel',
  callbackIps: [],
  timeoutMs: 1000,
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

const paidStatus = (clientReference: string, amount = 1.5) => ({
  responseCode: '0000',
  data: {
    status: 'Paid',
    transactionId: 'hub_tx_9',
    clientReference,
    amount,
    charges: 0.03,
    amountAfterCharges: amount - 0.03,
    paymentMethod: 'mobilemoney',
  },
})

describe('loadHubtelConfig', () => {
  test('requires the credentials and an explicit payload shape', () => {
    expect(() => loadHubtelConfig({})).toThrow(HubtelConfigError)
    expect(() =>
      loadHubtelConfig({
        HUBTEL_CLIENT_ID: 'a',
        HUBTEL_CLIENT_SECRET: 'b',
        HUBTEL_MERCHANT_ACCOUNT: 'c',
        HUBTEL_PAYLOAD_SHAPE: 'weird',
        NEXT_PUBLIC_APP_URL: 'https://x',
      })
    ).toThrow(/nested|flat/)
    const loaded = loadHubtelConfig({
      HUBTEL_CLIENT_ID: 'a',
      HUBTEL_CLIENT_SECRET: 'b',
      HUBTEL_MERCHANT_ACCOUNT: 'HM1',
      HUBTEL_PAYLOAD_SHAPE: 'nested',
      NEXT_PUBLIC_APP_URL: 'https://vote.example/',
      HUBTEL_CALLBACK_IPS: ' 1.2.3.4, 5.6.7.8 ',
    })
    expect(loaded.receiveUrl).toContain('/merchants/HM1/')
    expect(loaded.statusUrl).toContain('/transactions/HM1/')
    expect(loaded.callbackUrl).toBe('https://vote.example/api/payments/callback/hubtel')
    expect(loaded.callbackIps).toEqual(['1.2.3.4', '5.6.7.8'])
  })
})

describe('getPaymentProvider', () => {
  test('a missing Hubtel config reads as "not configured" rather than a crash', () => {
    const saved = { ...process.env }
    delete process.env.HUBTEL_CLIENT_ID
    try {
      expect(() => getPaymentProvider('hubtel')).toThrow(PaymentProviderNotConfiguredError)
    } finally {
      process.env = saved
    }
  })
})

describe('HubtelClient', () => {
  test('sends Basic auth and the receive payload, retries once on 429', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    let first = true
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (first) {
        first = false
        return jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '1' })
      }
      return jsonResponse({ ResponseCode: '0001', Data: { TransactionId: 'hub_tx_1', ClientReference: 'pay_1' } })
    })
    const client = new HubtelClient(cfg, fetchImpl, async () => {})
    const body = await client.receiveMobileMoney({
      clientReference: 'pay_1',
      amountCedis: '1.50',
      msisdn: '233241234567',
      customerName: 'Voter',
      description: 'd',
      channel: 'mtn-gh',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(calls[0].url).toBe(cfg.receiveUrl)
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`)
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      CustomerName: 'Voter',
      CustomerMsisdn: '233241234567',
      Amount: 1.5,
      PrimaryCallbackUrl: cfg.callbackUrl,
      Description: 'd',
      ClientReference: 'pay_1',
      Channel: 'mtn-gh',
    })
    expect(body).toMatchObject({ ResponseCode: '0001' })
  })

  test('status check appends the client reference and throws on HTTP errors', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`${cfg.statusUrl}?clientReference=pay_1`)
      return jsonResponse({ message: 'nope' }, 401)
    })
    const client = new HubtelClient(cfg, fetchImpl, async () => {})
    await expect(client.statusByClientReference('pay_1')).rejects.toBeInstanceOf(HubtelHttpError)
  })

  test('a network fault is retried once, then surfaces', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    const client = new HubtelClient(cfg, fetchImpl, async () => {})
    await expect(client.statusByClientReference('pay_1')).rejects.toThrow(/ECONNRESET/)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('HubtelPaymentProvider', () => {
  let statusAnswer: () => Response
  let receiveAnswer: () => Response
  let fetchImpl: ReturnType<typeof vi.fn>
  let provider: HubtelPaymentProvider

  beforeEach(() => {
    statusAnswer = () => jsonResponse(paidStatus('pay_1'))
    receiveAnswer = () =>
      jsonResponse({ ResponseCode: '0001', Data: { TransactionId: 'hub_tx_1', ClientReference: 'pay_1' } })
    fetchImpl = vi.fn(async (url: string) => (url.startsWith(cfg.statusUrl) ? statusAnswer() : receiveAnswer()))
    provider = new HubtelPaymentProvider(cfg, new HubtelClient(cfg, fetchImpl, async () => {}))
  })
  afterEach(() => vi.restoreAllMocks())

  test("initiate converts pesewas to cedis, picks the channel and returns Hubtel's id", async () => {
    const out = await provider.initiate({
      paymentId: 'pay_1',
      amount: 150,
      payerPhone: '233241234567',
      description: '10 votes',
    })
    expect(out.providerReference).toBe('hub_tx_1')
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    expect(body.Amount).toBe(1.5)
    expect(body.ClientReference).toBe('pay_1')
    expect(body.Channel).toBe('mtn-gh')
  })

  test('initiate keeps the placeholder when Hubtel gives no id, and throws on a decline', async () => {
    receiveAnswer = () => jsonResponse({ ResponseCode: '0001', Data: { ClientReference: 'pay_1' } })
    const out = await provider.initiate({
      paymentId: 'pay_1',
      amount: 150,
      payerPhone: '233241234567',
      description: 'x',
    })
    expect(out.providerReference).toBe('local_pay_1')

    receiveAnswer = () => jsonResponse({ ResponseCode: '4075', Data: { Description: 'Insufficient balance' } })
    await expect(
      provider.initiate({ paymentId: 'pay_1', amount: 150, payerPhone: '233241234567', description: 'x' })
    ).rejects.toThrow(/Insufficient balance/)
  })

  test('a callback is only accepted after the status API confirms it', async () => {
    const callback = JSON.stringify({
      ResponseCode: '0000',
      Data: { ClientReference: 'pay_1', TransactionId: 'hub_tx_9', Amount: 1.5 },
    })
    const result = await provider.verifyCallback(new Headers(), callback)
    expect(result).toMatchObject({
      providerReference: 'hub_tx_9',
      clientReference: 'pay_1',
      status: 'success',
      amountPesewas: 150,
    })
    expect(fetchImpl).toHaveBeenCalledWith(`${cfg.statusUrl}?clientReference=pay_1`, expect.anything())

    // Same POST, but Hubtel says unpaid: rejected, nothing to confirm.
    statusAnswer = () =>
      jsonResponse({ responseCode: '0000', data: { status: 'Unpaid', clientReference: 'pay_1', amount: 1.5 } })
    expect(await provider.verifyCallback(new Headers(), callback)).toBeNull()

    // A POST claiming success for a reference Hubtel reports failed becomes a failed result.
    statusAnswer = () =>
      jsonResponse({ responseCode: '0000', data: { status: 'Refunded', clientReference: 'pay_1', amount: 1.5 } })
    expect((await provider.verifyCallback(new Headers(), callback))?.status).toBe('failed')
  })

  test('the callback body never decides the outcome', async () => {
    // Body says failed, Hubtel says paid: the money moved, so it is a success.
    const callback = JSON.stringify({ ResponseCode: '2001', Data: { ClientReference: 'pay_1' } })
    expect((await provider.verifyCallback(new Headers(), callback))?.status).toBe('success')
  })

  test('junk, unknown references and the IP allowlist', async () => {
    expect(await provider.verifyCallback(new Headers(), 'not json')).toBeNull()
    expect(await provider.verifyCallback(new Headers(), JSON.stringify({ hello: 1 }))).toBeNull()
    statusAnswer = () => jsonResponse({ responseCode: '4000', message: 'not found', data: null })
    expect(
      await provider.verifyCallback(
        new Headers(),
        JSON.stringify({ ResponseCode: '0000', Data: { ClientReference: 'nope' } })
      )
    ).toBeNull()

    const guarded = new HubtelPaymentProvider(
      { ...cfg, callbackIps: ['1.2.3.4'] },
      new HubtelClient(cfg, fetchImpl, async () => {})
    )
    statusAnswer = () => jsonResponse(paidStatus('pay_1'))
    const callback = JSON.stringify({ ResponseCode: '0000', Data: { ClientReference: 'pay_1' } })
    expect(await guarded.verifyCallback(new Headers({ 'x-forwarded-for': '9.9.9.9' }), callback)).toBeNull()
    expect(
      await guarded.verifyCallback(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), callback)
    ).not.toBeNull()
  })

  test('a status API outage surfaces as an error so the route answers 500 and Hubtel retries', async () => {
    statusAnswer = () => jsonResponse({ error: 'down' }, 503)
    const callback = JSON.stringify({ ResponseCode: '0000', Data: { ClientReference: 'pay_1' } })
    await expect(provider.verifyCallback(new Headers(), callback)).rejects.toBeInstanceOf(HubtelHttpError)
  })

  test('checkStatus and verifiedResult for reconciliation', async () => {
    expect(await provider.checkStatus({ providerReference: 'local_pay_1', clientReference: 'pay_1' })).toBe('success')
    const verified = await provider.verifiedResult('pay_1')
    expect(verified).toMatchObject({ status: 'success', amountPesewas: 150, clientReference: 'pay_1' })
    statusAnswer = () => jsonResponse({ responseCode: '0000', data: { status: 'Unpaid', clientReference: 'pay_1' } })
    expect(await provider.checkStatus({ providerReference: 'x', clientReference: 'pay_1' })).toBe('pending')
    expect(await provider.verifiedResult('pay_1')).toBeNull()
  })
})
