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
