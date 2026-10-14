import { formatPesewas } from '../../money'
import type { CallbackResult, InitiateInput, InitiateResult, PaymentProvider, ProviderStatus } from '../provider'
import { HubtelClient } from './client'
import { loadHubtelConfig, type HubtelConfig } from './config'
import {
  NESTED_ACCEPTED,
  channelForMsisdn,
  parseHubtelCallback,
  parseHubtelStatus,
  type HubtelNormalized,
} from './parse'

export const HUBTEL_PROVIDER_NAME = 'hubtel'

/**
 * Hubtel mobile-money adapter (decision #11).
 *
 * Hubtel does not sign callbacks, so a callback is only a hint: the adapter
 * reads the client reference out of it and asks Hubtel's status API, and the
 * `CallbackResult` is built from that answer, never from the posted body.
 * That is payment rule 2's "status check against the provider API". Our
 * payment id is the client reference, so the pipeline's client-reference
 * fallback matches even if Hubtel's transaction id was never stored.
 */
export class HubtelPaymentProvider implements PaymentProvider {
  readonly name = HUBTEL_PROVIDER_NAME
  private readonly client: HubtelClient

  constructor(
    private readonly cfg: HubtelConfig = loadHubtelConfig(),
    client?: HubtelClient
  ) {
    this.client = client ?? new HubtelClient(cfg)
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const amountCedis = formatPesewas(input.amount, '').trim()
    const body = await this.client.receiveMobileMoney({
      clientReference: input.paymentId,
      amountCedis,
      msisdn: input.payerPhone,
      customerName: 'Voter',
      description: input.description.slice(0, 100),
      channel: channelForMsisdn(input.payerPhone),
    })
    const code = pickString(body, 'ResponseCode')
    if (!code || !NESTED_ACCEPTED.has(code)) {
      const message =
        pickString(pick(body, 'Data'), 'Description') ??
        pickString(body, 'Message') ??
        pickString(body, 'ResponseMessage') ??
        code ??
        'unknown'
      throw new Error(`Hubtel declined the request: ${message}`)
    }
    const transactionId = pickString(pick(body, 'Data'), 'TransactionId')
    return {
      // Hubtel's id when it gives one now; otherwise keep the placeholder and
      // let the callback's client reference match the payment.
      providerReference: transactionId ? transactionId : `local_${input.paymentId}`,
      instructions: 'A mobile money prompt has been sent to your phone. Enter your PIN to approve it.',
    }
  }

  async verifyCallback(headers: Headers, rawBody: string): Promise<CallbackResult | null> {
    if (this.cfg.callbackIps.length > 0) {
      const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || ''
      if (!this.cfg.callbackIps.includes(ip)) return null
    }
    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return null
    }
    const hint = parseHubtelCallback(body, this.cfg.payloadShape)
    if (!hint) return null

    // Rule 2: the verdict comes from Hubtel's status API, not from the POST.
    const verified = await this.fetchStatus(hint.clientReference)
    if (!verified || verified.status === 'unknown' || verified.status === 'pending') return null

    return this.toResult(verified, { callback: body, status: verified.raw })
  }

  async checkStatus(ref: { providerReference: string; clientReference: string }): Promise<ProviderStatus> {
    const verified = await this.fetchStatus(ref.clientReference)
    if (!verified) return 'unknown'
    return verified.status
  }

  /** The verified record as a `CallbackResult`, for reconciliation to reuse the raw status payload. */
  async verifiedResult(clientReference: string): Promise<CallbackResult | null> {
    const verified = await this.fetchStatus(clientReference)
    if (!verified || verified.status === 'unknown' || verified.status === 'pending') return null
    return this.toResult(verified, { status: verified.raw })
  }

  private async fetchStatus(clientReference: string): Promise<HubtelNormalized | null> {
    const body = await this.client.statusByClientReference(clientReference)
    return parseHubtelStatus(body, this.cfg.payloadShape)
  }

  private toResult(verified: HubtelNormalized, raw: unknown): CallbackResult {
    return {
      provider: this.name,
      providerReference: verified.transactionId ?? `local_${verified.clientReference}`,
      clientReference: verified.clientReference,
      status: verified.status === 'success' ? 'success' : 'failed',
      amountPesewas: verified.amountPesewas ?? undefined,
      network: verified.network ?? undefined,
      raw,
    }
  }
}

function pick(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) if (k.toLowerCase() === lower) return v
  return undefined
}

function pickString(obj: unknown, key: string): string | null {
  const v = pick(obj, key)
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}
