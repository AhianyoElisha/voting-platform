/**
 * The payment aggregator boundary (USSD_AND_PAYMENTS.md). The real provider
 * is OPEN_QUESTIONS #11; everything above this interface is provider-agnostic.
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
}

export type CallbackStatus = 'success' | 'failed'

export interface CallbackResult {
  providerReference: string
  /** Our payment id when the provider echoes it; lets a callback match a payment whose provider reference was never stored. */
  clientReference?: string
  status: CallbackStatus
  /** The raw payload, stored on the Payment for audits (rule 7). */
  raw: unknown
  /** Mobile network when the provider reports it. */
  network?: string
}

export type ProviderStatus = 'success' | 'failed' | 'pending' | 'unknown'

export interface PaymentProvider {
  readonly name: string
  initiate(input: InitiateInput): Promise<InitiateResult>
  /** Returns null when the callback is not authentic. Never throws on bad input. */
  verifyCallback(headers: Headers, rawBody: string): Promise<CallbackResult | null>
  /**
   * For reconciliation of stale pending payments (rule 5). `providerReference`
   * may still be our `local_<id>` placeholder when storing the provider's
   * reference failed; `clientReference` is always our payment id.
   */
  checkStatus(ref: { providerReference: string; clientReference: string }): Promise<ProviderStatus>
}
