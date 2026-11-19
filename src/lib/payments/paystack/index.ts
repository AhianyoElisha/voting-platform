import type {
  CallbackResult,
  InitiateInput,
  InitiateResult,
  OtpResult,
  PaymentProvider,
  ProviderStatus,
} from '../provider'
import { PaystackClient } from './client'
import { loadPaystackConfig, type PaystackConfig } from './config'
import {
  localPhone,
  parseTransaction,
  providerForMsisdn,
  verdictFor,
  verifySignature,
  type PaystackTransaction,
} from './parse'

export const PAYSTACK_PROVIDER_NAME = 'paystack'

const PROMPT_TEXT = 'A mobile money prompt has been sent to your phone. Enter your PIN to approve it.'
const OTP_TEXT = 'Enter the code your network has sent you by SMS to continue.'

/**
 * Paystack mobile-money adapter (decided 2026-11-12; Hubtel stays for USSD).
 *
 * Our payment id is the Paystack `reference`, so it is both the provider
 * reference and the client reference. Paystack signs its webhooks
 * (HMAC-SHA512 of the raw body with the secret key), so a `charge.success`
 * event with a valid signature is payment rule 2's "verified provider
 * callback"; reconciliation asks the verify endpoint. Neither needs a fixed
 * outbound IP.
 *
 * Some numbers need a one-time code before the prompt (`send_otp`): initiate
 * says so with `nextAction: 'otp'`, and `submitOtp` continues the charge.
 * Submitting a code never confirms anything; only the webhook or verify does.
 */
export class PaystackPaymentProvider implements PaymentProvider {
  readonly name = PAYSTACK_PROVIDER_NAME
  private readonly client: PaystackClient

  constructor(
    private readonly cfg: PaystackConfig = loadPaystackConfig(),
    client?: PaystackClient
  ) {
    this.client = client ?? new PaystackClient(cfg)
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const provider = providerForMsisdn(input.payerPhone)
    if (!provider) throw new Error('Paystack: unsupported mobile network for this number')
    const { body } = await this.client.chargeMobileMoney({
      reference: input.paymentId,
      amount: input.amount,
      email: `${input.paymentId}@${this.cfg.customerEmailDomain}`,
      phone: localPhone(input.payerPhone),
      provider,
      metadata: { payment_id: input.paymentId, description: input.description.slice(0, 100) },
    })
    return { providerReference: input.paymentId, ...this.nextStep(body) }
  }

  async submitOtp(ref: { providerReference: string; otp: string }): Promise<OtpResult> {
    const { body } = await this.client.submitOtp(ref.providerReference, ref.otp)
    return this.nextStep(body)
  }

  /** Reads a charge or submit_otp answer. Throws when Paystack refused, so no debit is pending. */
  private nextStep(body: unknown): OtpResult {
    const envelope = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const tx = parseTransaction(envelope.data)
    if (envelope.status !== true || !tx || tx.status === 'failed') {
      const message = tx?.gatewayResponse ?? (typeof envelope.message === 'string' ? envelope.message : 'unknown')
      throw new Error(`Paystack declined the charge: ${message}`)
    }
    if (tx.status === 'send_otp') return { nextAction: 'otp', instructions: tx.displayText ?? OTP_TEXT }
    return { instructions: tx.displayText ?? PROMPT_TEXT }
  }

  async verifyCallback(headers: Headers, rawBody: string): Promise<CallbackResult | 'ignored' | null> {
    if (this.cfg.callbackIps.length > 0) {
      const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || ''
      if (!this.cfg.callbackIps.includes(ip)) return null
    }
    if (!verifySignature(rawBody, headers.get('x-paystack-signature'), this.cfg.secretKey)) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return null
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const event = parsed as Record<string, unknown>
    // Signed but not a charge result (transfers, refunds, disputes): acknowledge so Paystack stops retrying.
    if (event.event !== 'charge.success') return 'ignored'
    const tx = parseTransaction(event.data)
    if (!tx || tx.status !== 'success') return null
    return this.toResult(tx, { webhook: event })
  }

  async checkStatus(ref: { providerReference: string; clientReference: string }): Promise<ProviderStatus> {
    const tx = await this.fetch(ref.clientReference)
    return tx ? verdictFor(tx.status) : 'unknown'
  }

  async verifiedResult(clientReference: string): Promise<CallbackResult | null> {
    const tx = await this.fetch(clientReference)
    if (!tx) return null
    const verdict = verdictFor(tx.status)
    if (verdict !== 'success' && verdict !== 'failed') return null
    return this.toResult(tx, { verify: tx })
  }

  private async fetch(reference: string): Promise<PaystackTransaction | null> {
    const { body } = await this.client.verify(reference)
    const envelope = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    if (envelope.status !== true) return null
    const tx = parseTransaction(envelope.data)
    return tx && tx.reference === reference ? tx : null
  }

  private toResult(tx: PaystackTransaction, raw: unknown): CallbackResult | null {
    const verdict = verdictFor(tx.status)
    // A success is credited only with an amount in pesewas the pipeline can
    // compare with the payment (rule 6); anything else is left for a human.
    if (verdict === 'success' && (tx.currency !== 'GHS' || tx.amount === null)) {
      console.error(`[paystack] ${tx.reference}: success without a GHS amount, not credited`)
      return null
    }
    return {
      provider: this.name,
      providerReference: tx.reference,
      clientReference: tx.reference,
      status: verdict === 'success' ? 'success' : 'failed',
      amountPesewas: tx.amount ?? undefined,
      feePesewas: tx.fees ?? undefined,
      network: tx.network ?? undefined,
      raw,
    }
  }
}
