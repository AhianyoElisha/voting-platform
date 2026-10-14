import { cedisToPesewas } from '../../money'
import type { HubtelPayloadShape } from './config'

/**
 * Pure parsers for what Hubtel sends and answers. Two shapes exist in the
 * wild; both normalize to the same record, and anything unrecognized yields
 * null so the caller fails closed. Key lookup is case-insensitive because
 * Hubtel mixes `ClientReference` and `clientReference` between APIs.
 */
export type HubtelOutcome = 'success' | 'failed' | 'pending' | 'unknown'

export interface HubtelNormalized {
  clientReference: string
  transactionId: string | null
  /** Hubtel's `Amount` in pesewas; null when absent or unparseable. */
  amountPesewas: number | null
  status: HubtelOutcome
  network: string | null
  /** Reported fees, for OPEN_QUESTIONS #36; not used by the split. */
  chargesPesewas: number | null
  amountAfterChargesPesewas: number | null
  raw: unknown
}

function pick(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

export function amountToPesewas(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  try {
    if (typeof v === 'number') return Number.isFinite(v) ? cedisToPesewas(v.toFixed(2)) : null
    if (typeof v === 'string') return cedisToPesewas(v)
  } catch {
    return null
  }
  return null
}

/** Response codes that mean "paid" in the nested shape. */
const NESTED_SUCCESS = new Set(['0000'])
/** Codes that mean "accepted, still pending" at initiation time. */
export const NESTED_ACCEPTED = new Set(['0000', '0001', '00'])

function flatStatus(v: unknown): HubtelOutcome {
  const s = asString(v)?.toLowerCase()
  if (!s) return 'unknown'
  if (['completed', 'success', 'successful', 'paid'].includes(s)) return 'success'
  if (['failed', 'cancelled', 'canceled', 'timeout', 'declined', 'refunded', 'reversed'].includes(s)) return 'failed'
  if (['pending', 'unpaid', 'processing', 'initiated'].includes(s)) return 'pending'
  return 'unknown'
}

function normalize(container: unknown, status: HubtelOutcome, raw: unknown): HubtelNormalized | null {
  const clientReference = asString(pick(container, 'ClientReference'))
  if (!clientReference) return null
  return {
    clientReference,
    transactionId: asString(pick(container, 'TransactionId')) ?? asString(pick(container, 'CheckoutId')),
    amountPesewas: amountToPesewas(pick(container, 'Amount')),
    status,
    network: asString(pick(container, 'PaymentMethod')) ?? asString(pick(container, 'Channel')) ?? null,
    chargesPesewas: amountToPesewas(pick(container, 'Charges')),
    amountAfterChargesPesewas: amountToPesewas(pick(container, 'AmountAfterCharges')),
    raw,
  }
}

/** A callback body (already JSON-parsed). */
export function parseHubtelCallback(body: unknown, shape: HubtelPayloadShape): HubtelNormalized | null {
  if (!body || typeof body !== 'object') return null
  if (shape === 'nested') {
    const code = asString(pick(body, 'ResponseCode'))
    const data = pick(body, 'Data')
    if (!code || !data) return null
    return normalize(data, NESTED_SUCCESS.has(code) ? 'success' : 'failed', body)
  }
  const data = pick(body, 'Data') ?? body
  const status = flatStatus(pick(data, 'Status'))
  if (status === 'unknown') {
    // Some flat payloads only carry a response code.
    const code = asString(pick(body, 'ResponseCode'))
    if (!code) return null
    return normalize(data, code === '0000' || code === '00' ? 'success' : 'failed', body)
  }
  return normalize(data, status, body)
}

/** A status-check response body. The authoritative source for confirmation. */
export function parseHubtelStatus(body: unknown, shape: HubtelPayloadShape): HubtelNormalized | null {
  if (!body || typeof body !== 'object') return null
  const data = pick(body, 'Data') ?? body
  const code = asString(pick(body, 'ResponseCode'))
  if (shape === 'nested' && code && !NESTED_ACCEPTED.has(code)) {
    // The query itself failed (unknown reference, auth): not a verdict on the payment.
    return null
  }
  const status = flatStatus(pick(data, 'Status'))
  if (status === 'unknown') return null
  return normalize(data, status, body)
}

/** Hubtel channel ids by Ghanaian mobile prefix. Null for anything else. */
export function channelForMsisdn(msisdn: string): string | null {
  const national = msisdn.startsWith('233') ? msisdn.slice(3) : msisdn.replace(/^0/, '')
  const p2 = national.slice(0, 2)
  if (['24', '54', '55', '59', '53'].includes(p2)) return 'mtn-gh'
  if (['20', '50'].includes(p2)) return 'vodafone-gh'
  if (['26', '56', '27', '57'].includes(p2)) return 'tigo-gh'
  return null
}
