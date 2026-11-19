/**
 * How many votes one payment may buy (decision #16, 2026-11-13): at least 1,
 * and at most what fits under a money cap per payment. The cap is a platform
 * setting, `VOTE_PAYMENT_MAX_PESEWAS`, GHS 2,000 by default: mobile-money
 * wallets have transaction limits, so an amount is what can actually be paid.
 *
 * Pure apart from reading the environment, so the web form, the USSD menu
 * and the payment pipeline all apply the same limit.
 */
export const VOTE_QUANTITY_MIN = 1
export const VOTE_PAYMENT_MAX_DEFAULT_PESEWAS = 200_000

/**
 * A guard on the number itself, far above any real purchase: it keeps absurd
 * input from reaching the arithmetic. The limit that matters is the cap.
 */
export const VOTE_QUANTITY_SANITY_MAX = 1_000_000

/** The cap in pesewas. An unset or unusable setting falls back to the default rather than removing the cap. */
export function votePaymentMaxPesewas(): number {
  const raw = process.env.VOTE_PAYMENT_MAX_PESEWAS
  if (raw === undefined || raw.trim() === '') return VOTE_PAYMENT_MAX_DEFAULT_PESEWAS
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    console.error(
      `[vote-limits] VOTE_PAYMENT_MAX_PESEWAS must be a positive whole number, got "${raw}"; using the default`
    )
    return VOTE_PAYMENT_MAX_DEFAULT_PESEWAS
  }
  return value
}

/**
 * The most votes one payment can buy at `votePrice` pesewas each. Never below
 * the minimum of 1: a single vote can always be bought, even at a price above
 * the cap.
 */
export function maxVotesFor(votePrice: number, cap = votePaymentMaxPesewas()): number {
  if (!Number.isSafeInteger(votePrice) || votePrice <= 0) return VOTE_QUANTITY_MIN
  return Math.min(VOTE_QUANTITY_SANITY_MAX, Math.max(VOTE_QUANTITY_MIN, Math.floor(cap / votePrice)))
}
