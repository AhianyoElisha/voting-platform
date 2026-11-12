import { confirmPayment, type ConfirmOutcome } from '../votes-server'
import type { PaymentProvider } from './provider'

/**
 * The one entry point for provider callbacks, shared by the real callback
 * route and the mock's dev confirmation. Verifies first; an inauthentic
 * payload never reaches `confirmPayment` (rule 2).
 */
export type CallbackHandling =
  | { ok: false; status: 400; reason: 'unverified' }
  | { ok: true; status: 200; outcome: ConfirmOutcome | 'ignored'; paymentId: string | null }

export async function handleProviderCallback(
  provider: PaymentProvider,
  headers: Headers,
  rawBody: string
): Promise<CallbackHandling> {
  const result = await provider.verifyCallback(headers, rawBody)
  if (!result) return { ok: false, status: 400, reason: 'unverified' }
  if (result === 'ignored') return { ok: true, status: 200, outcome: 'ignored', paymentId: null }
  const { outcome, payment } = await confirmPayment(result)
  return { ok: true, status: 200, outcome, paymentId: payment?.$id ?? null }
}
