import crypto from 'crypto'
import type { ProviderStatus } from '../provider'

/**
 * Pure helpers for Paystack's payloads, kept apart from HTTP so they are easy
 * to test. Field names follow Paystack's API reference and OpenAPI spec
 * (`PaystackOSS/openapi`); confirm against test mode (docs/SMOKE_TEST.md).
 */

/** Paystack's mobile-money provider codes for Ghana. */
export type PaystackMomoProvider = 'mtn' | 'vod' | 'atl'

/** By national prefix: MTN, Telecel (Paystack's `vod`) and AirtelTigo (`atl`). Null for anything else. */
export function providerForMsisdn(msisdn: string): PaystackMomoProvider | null {
  const national = nationalDigits(msisdn)
  const p2 = national.slice(0, 2)
  if (['24', '54', '55', '59', '53'].includes(p2)) return 'mtn'
  if (['20', '50'].includes(p2)) return 'vod'
  if (['26', '56', '27', '57'].includes(p2)) return 'atl'
  return null
}

function nationalDigits(msisdn: string): string {
  return msisdn.startsWith('233') ? msisdn.slice(3) : msisdn.replace(/^0/, '')
}

/** 233241234567 → 0241234567, the local format in Paystack's examples. */
export function localPhone(msisdn: string): string {
  return `0${nationalDigits(msisdn)}`
}

/** Constant-time check of `x-paystack-signature`: HMAC-SHA512 of the raw body with the secret key. */
export function verifySignature(rawBody: string, signature: string | null, secretKey: string): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false
  const expected = new Uint8Array(crypto.createHmac('sha512', secretKey).update(rawBody, 'utf8').digest())
  return crypto.timingSafeEqual(expected, new Uint8Array(Buffer.from(signature, 'hex')))
}

export interface PaystackTransaction {
  reference: string
  status: string
  /** Pesewas, as Paystack reports it. */
  amount: number | null
  currency: string | null
  network: string | null
  gatewayResponse: string | null
  displayText: string | null
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** The `data` object of a charge, submit_otp, verify response or webhook event. Null when unusable. */
export function parseTransaction(data: unknown): PaystackTransaction | null {
  const d = obj(data)
  if (!d) return null
  const reference = str(d.reference)
  const status = str(d.status)
  if (!reference || !status) return null
  const amount = typeof d.amount === 'number' && Number.isSafeInteger(d.amount) ? d.amount : null
  const auth = obj(d.authorization)
  const momo = obj(d.mobile_money)
  return {
    reference,
    status: status.toLowerCase(),
    amount,
    currency: str(d.currency)?.toUpperCase() ?? null,
    network: str(auth?.bank) ?? str(momo?.provider) ?? null,
    gatewayResponse: str(d.gateway_response) ?? str(d.message),
    displayText: str(d.display_text),
  }
}

/**
 * Verify statuses → our verdict. Only `success` is money in. `failed`,
 * `abandoned` (the payer never approved) and `reversed` mean no money for a
 * still-pending payment; a later success still overrides a failed payment in
 * `confirmPayment`, so a slow approval is never lost. Everything else is in
 * flight.
 */
export function verdictFor(status: string): ProviderStatus {
  if (status === 'success') return 'success'
  if (status === 'failed' || status === 'abandoned' || status === 'reversed') return 'failed'
  if (['ongoing', 'pending', 'processing', 'queued', 'send_otp', 'pay_offline'].includes(status)) return 'pending'
  return 'unknown'
}
