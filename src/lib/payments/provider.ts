/**
 * The payment aggregator boundary (USSD_AND_PAYMENTS.md). Hubtel is the
 * USSD aggregator and Paystack the payment provider (decided 2026-11-12,
 * amending #11); everything above this interface is provider-agnostic.
 *
 * Rules the pipeline enforces around it:
 * - A Payment exists as `pending` before `initiate` is called (rule 1).
 * - Only a result from `verifyCallback` (signature checked) or `checkStatus`
 *   may move a Payment to `success` (rule 2). Nothing else does.
 */
export interface InitiateInput {
  paymentId: string
  /** Pesewas. */
  amount: number
  /** E.164 digits without the plus, e.g. 233241234567. */
  payerPhone: string
  description: string
}

export interface InitiateResult {
  /** The provider's transaction reference; unique per payment. */
  providerReference: string
  /** Optional text to show the payer, e.g. "Approve the prompt on your phone". */
  instructions?: string
  /** `otp`: the payer must enter a one-time code (sent by their network) before the prompt; see `submitOtp`. */
  nextAction?: 'otp'
}

export interface OtpResult {
  instructions?: string
  nextAction?: 'otp'
}

export type CallbackStatus = 'success' | 'failed'

export interface CallbackResult {
  /** Name of the adapter that verified this result; lets the pipeline trust a client-reference match. */
  provider?: string
  providerReference: string
  /** Our payment id when the provider echoes it; lets a callback match a payment whose provider reference was never stored. */
  clientReference?: string
  status: CallbackStatus
  /** The amount the provider says was paid, in pesewas. When present it must equal the Payment's amount. */
  amountPesewas?: number
  /** The provider's own charge on this payment, in pesewas, when it reports one (decision #36). */
  feePesewas?: number
  /** The raw payload, stored on the Payment for audits (rule 7). */
  raw: unknown
  /** Mobile network when the provider reports it. */
  network?: string
}

export type ProviderStatus = 'success' | 'failed' | 'pending' | 'unknown'

export interface PaymentProvider {
  readonly name: string
  initiate(input: InitiateInput): Promise<InitiateResult>
  /**
   * Returns null when the callback is not authentic. `ignored`: authentic but
   * not a payment result (e.g. a transfer event), to be acknowledged and
   * dropped. Never throws on bad input.
   */
  verifyCallback(headers: Headers, rawBody: string): Promise<CallbackResult | 'ignored' | null>
  /** Optional: continues a charge that asked for a one-time code. Never confirms a payment. */
  submitOtp?(ref: { providerReference: string; otp: string }): Promise<OtpResult>
  /**
   * For reconciliation of stale pending payments (rule 5). `providerReference`
   * may still be our `local_<id>` placeholder when storing the provider's
   * reference failed; `clientReference` is always our payment id.
   */
  checkStatus(ref: { providerReference: string; clientReference: string }): Promise<ProviderStatus>
  /** Optional: the full verified result for a settled payment, so reconciliation can apply amounts and raw payloads. */
  verifiedResult?(clientReference: string): Promise<CallbackResult | null>
}
