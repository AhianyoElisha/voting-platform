import { afterEach, describe, expect, test } from 'vitest'
import {
  DEFAULT_COMMISSION_BPS,
  FeesNotConfiguredError,
  PROVIDER_FEE_MAX_BPS,
  effectiveCommissionBps,
  platformCommissionBps,
  settleWithProviderFee,
  splitAmount,
} from '../fees'

afterEach(() => {
  delete process.env.PLATFORM_COMMISSION_BPS
})

describe('splitAmount', () => {
  test('parts always sum to the amount, fee rounds down', () => {
    expect(splitAmount(1000, 1000)).toEqual({ platformFee: 100, organizerNet: 900 })
    expect(splitAmount(1, 1000)).toEqual({ platformFee: 0, organizerNet: 1 })
    expect(splitAmount(999, 750)).toEqual({ platformFee: 74, organizerNet: 925 })
    for (const amount of [0, 1, 7, 99, 12345, 9999999]) {
      for (const bps of [0, 1, 700, 1000, 10000]) {
        const { platformFee, organizerNet } = splitAmount(amount, bps)
        expect(platformFee + organizerNet).toBe(amount)
        expect(Number.isInteger(platformFee)).toBe(true)
      }
    }
  })

  test('rejects non-pesewa amounts and bad rates', () => {
    expect(() => splitAmount(1.5, 1000)).toThrow()
    expect(() => splitAmount(100, -1)).toThrow(FeesNotConfiguredError)
    expect(() => splitAmount(100, 10001)).toThrow(FeesNotConfiguredError)
  })
})

describe('commission rate (decision #2)', () => {
  test('defaults to 10% when the env var is unset, refuses invalid values', () => {
    expect(platformCommissionBps()).toBe(DEFAULT_COMMISSION_BPS)
    expect(DEFAULT_COMMISSION_BPS).toBe(1000)
    process.env.PLATFORM_COMMISSION_BPS = ''
    expect(platformCommissionBps()).toBe(1000)
    process.env.PLATFORM_COMMISSION_BPS = 'ten'
    expect(() => platformCommissionBps()).toThrow(FeesNotConfiguredError)
    process.env.PLATFORM_COMMISSION_BPS = '12.5'
    expect(() => platformCommissionBps()).toThrow(FeesNotConfiguredError)
    process.env.PLATFORM_COMMISSION_BPS = '10001'
    expect(() => platformCommissionBps()).toThrow(FeesNotConfiguredError)
  })

  test('reads the platform rate and lets an organization override it', () => {
    process.env.PLATFORM_COMMISSION_BPS = '1000'
    expect(platformCommissionBps()).toBe(1000)
    expect(effectiveCommissionBps(null)).toBe(1000)
    expect(effectiveCommissionBps(700)).toBe(700)
    expect(effectiveCommissionBps(0)).toBe(0)
  })
})

describe("provider's charge off the top (decision #36)", () => {
  const split = (amount: number, bps = 1000) => ({ amount, ...splitAmount(amount, bps) })

  test('the charge comes off first and the rest keeps the initiation proportion', () => {
    // GHS 100.00 at 10%, Paystack takes 1.95: 98.05 is shared 9.80 / 88.25.
    expect(settleWithProviderFee(split(10000), 195)).toEqual({ providerFee: 195, platformFee: 980, organizerNet: 8825 })
    // An organization on 7.5%.
    expect(settleWithProviderFee(split(10000, 750), 195)).toEqual({
      providerFee: 195,
      platformFee: 735,
      organizerNet: 9070,
    })
    // A zero charge is a charge: recorded, nothing deducted.
    expect(settleWithProviderFee(split(10000), 0)).toEqual({ providerFee: 0, platformFee: 1000, organizerNet: 9000 })
  })

  test('the three parts always sum to the amount, in whole pesewas', () => {
    for (const amount of [1, 50, 99, 150, 1999, 10000, 123457, 200000]) {
      for (const bps of [0, 500, 750, 1000, 10000]) {
        for (const fee of [0, 1, Math.floor(amount * 0.0195), Math.floor(amount / 10)]) {
          const s = settleWithProviderFee(split(amount, bps), fee)
          const taken = s.providerFee ?? 0
          expect(taken + s.platformFee + s.organizerNet).toBe(amount)
          expect(Number.isInteger(s.platformFee) && Number.isInteger(s.organizerNet)).toBe(true)
          expect(s.platformFee).toBeGreaterThanOrEqual(0)
          expect(s.organizerNet).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  test('no charge reported, or one that is not believable, deducts nothing', () => {
    const unchanged = { providerFee: null, platformFee: 1000, organizerNet: 9000 }
    for (const fee of [undefined, null, -1, 1.5, NaN, 1001, 10000, 999999]) {
      expect(settleWithProviderFee(split(10000), fee as number)).toEqual(unchanged)
    }
    // Exactly at the ceiling is still accepted.
    expect(settleWithProviderFee(split(10000), (10000 * PROVIDER_FEE_MAX_BPS) / 10000).providerFee).toBe(1000)
  })
})
