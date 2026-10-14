import crypto from 'crypto'
import type { CallbackResult, InitiateInput, InitiateResult, PaymentProvider, ProviderStatus } from './provider'

/**
 * PLACEHOLDER provider for OPEN_QUESTIONS #11. Development only: `index.ts`
 * refuses to load it in production.
 *
 * It behaves like a real aggregator from the pipeline's point of view:
 * `initiate` returns a reference, and confirmation arrives as a callback that
 * must carry a valid HMAC over the raw body. The dev route signs with the same
 * secret, so the verification path is exercised end to end.
 */
export const MOCK_PROVIDER_NAME = 'mock'
export const MOCK_SIGNATURE_HEADER = 'x-mock-signature'

function secret(): string {
  const s = process.env.MOCK_PAYMENT_SECRET
  if (!s) throw new Error('MOCK_PAYMENT_SECRET is required for the mock payment provider')
  return s
}

export function signMockPayload(rawBody: string, key = secret()): string {
  return crypto.createHmac('sha256', key).update(rawBody).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = MOCK_PROVIDER_NAME

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    return {
      providerReference: `mock_${input.paymentId}`,
      instructions: 'Mock provider: no money moves. Confirm from the development panel.',
    }
  }

  async verifyCallback(headers: Headers, rawBody: string): Promise<CallbackResult | null> {
    const signature = headers.get(MOCK_SIGNATURE_HEADER) ?? ''
    let expected: string
    try {
      expected = signMockPayload(rawBody)
    } catch {
      return null
    }
    if (!signature || !safeEqual(signature, expected)) return null

    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return null
    }
    if (!body || typeof body !== 'object') return null
    const { providerReference, status } = body as { providerReference?: unknown; status?: unknown }
    if (typeof providerReference !== 'string' || !providerReference.startsWith('mock_')) return null
    if (status !== 'success' && status !== 'failed') return null
    return {
      providerReference,
      clientReference: providerReference.slice('mock_'.length),
      status,
      raw: body,
      network: 'MOCK',
    }
  }

  async checkStatus(): Promise<ProviderStatus> {
    return 'unknown'
  }
}
