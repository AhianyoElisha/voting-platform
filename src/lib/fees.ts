import { assertPesewas } from './money'

/**
 * Commission split (PRD 5.6). Rates are basis points (1/100 of a percent):
 * 1000 bps = 10%. Integer arithmetic only (rule 6): the platform fee rounds
 * down to the pesewa and the organizer receives the remainder, so the two
 * parts always sum to the amount.
 *
 * PLACEHOLDER for OPEN_QUESTIONS #2: the platform rate comes from
 * `PLATFORM_COMMISSION_BPS` with no default. Unset means payments cannot be
 * initiated, which is deliberate: nothing here settles the pricing model.
 */
export const BPS_DENOMINATOR = 10_000

export class FeesNotConfiguredError extends Error {
  constructor() {
    super('PLATFORM_COMMISSION_BPS is not set (OPEN_QUESTIONS #2)')
    this.name = 'FeesNotConfiguredError'
  }
}

export function isValidBps(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= BPS_DENOMINATOR
}

export function platformCommissionBps(): number {
  const raw = process.env.PLATFORM_COMMISSION_BPS
  if (raw === undefined || raw === '') throw new FeesNotConfiguredError()
  const bps = Number(raw)
  if (!isValidBps(bps)) throw new FeesNotConfiguredError()
  return bps
}

/** The organization's override when set, else the platform rate. */
export function effectiveCommissionBps(organizationOverride: number | null | undefined): number {
  if (organizationOverride !== null && organizationOverride !== undefined) {
    if (!isValidBps(organizationOverride)) throw new FeesNotConfiguredError()
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
