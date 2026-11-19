import { assertPesewas } from './money'

/**
 * Commission split (PRD 5.6). Rates are basis points (1/100 of a percent):
 * 1000 bps = 10%. Integer arithmetic only (rule 6): the platform fee rounds
 * down to the pesewa and the organizer receives the remainder, so the two
 * parts always sum to the amount.
 *
 * Decision #2 (2026-10-14): commission only, 10% of gross. That is the
 * default; `PLATFORM_COMMISSION_BPS` overrides it platform-wide and
 * `Organization.commissionRate` per organization. An invalid value refuses
 * payments rather than silently charging the wrong rate.
 */
export const BPS_DENOMINATOR = 10_000
export const DEFAULT_COMMISSION_BPS = 1000

export class FeesNotConfiguredError extends Error {
  constructor(detail = 'PLATFORM_COMMISSION_BPS is invalid') {
    super(detail)
    this.name = 'FeesNotConfiguredError'
  }
}

export function isValidBps(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= BPS_DENOMINATOR
}

export function platformCommissionBps(): number {
  const raw = process.env.PLATFORM_COMMISSION_BPS
  if (raw === undefined || raw === '') return DEFAULT_COMMISSION_BPS
  const bps = Number(raw)
  if (!isValidBps(bps))
    throw new FeesNotConfiguredError(`PLATFORM_COMMISSION_BPS must be an integer 0..10000, got "${raw}"`)
  return bps
}

/** The organization's override when set, else the platform rate. */
export function effectiveCommissionBps(organizationOverride: number | null | undefined): number {
  if (organizationOverride !== null && organizationOverride !== undefined) {
    if (!isValidBps(organizationOverride)) throw new FeesNotConfiguredError('Organization commissionRate is invalid')
    return organizationOverride
  }
  return platformCommissionBps()
}

export function splitAmount(amount: number, bps: number): { platformFee: number; organizerNet: number } {
  assertPesewas(amount)
  if (!isValidBps(bps)) throw new FeesNotConfiguredError()
  const platformFee = Math.floor((amount * bps) / BPS_DENOMINATOR)
  return { platformFee, organizerNet: amount - platformFee }
}

/**
 * A provider fee above this share of the payment is not believed (a unit
 * mix-up or a malformed payload) and is ignored rather than taken from
 * anyone. Paystack charges about 1.95% on Ghana mobile money.
 */
export const PROVIDER_FEE_MAX_BPS = 1000

export interface Settlement {
  /** The provider's charge taken off the top; null when none was reported or believed. */
  providerFee: number | null
  platformFee: number
  organizerNet: number
}

/**
 * Decision #36 (2026-11-13): the payment provider's charge comes off the
 * gross first and the remainder is shared between platform and organizer in
 * the proportion fixed when the payment started, so both bear the charge.
 *
 * `split` is the commission split made at initiation (on the gross, at the
 * rate in force then); `providerFee` is what the provider reports for this
 * payment, in pesewas. Integer arithmetic only: the platform's part rounds
 * down and the organizer takes the remainder, so
 * `providerFee + platformFee + organizerNet === amount` always.
 *
 * With no fee reported, or one that is not a believable amount, nothing is
 * deducted and the initiation split stands.
 */
export function settleWithProviderFee(
  split: { amount: number; platformFee: number; organizerNet: number },
  providerFee: number | null | undefined
): Settlement {
  const { amount, platformFee, organizerNet } = split
  const believable =
    typeof providerFee === 'number' &&
    Number.isSafeInteger(providerFee) &&
    providerFee >= 0 &&
    amount > 0 &&
    providerFee * BPS_DENOMINATOR <= amount * PROVIDER_FEE_MAX_BPS
  if (!believable) return { providerFee: null, platformFee, organizerNet }
  const net = amount - (providerFee as number)
  const platform = Math.floor((platformFee * net) / amount)
  return { providerFee: providerFee as number, platformFee: platform, organizerNet: net - platform }
}
