import { afterEach, describe, expect, test } from 'vitest'
import {
  DEFAULT_COMMISSION_BPS,
  FeesNotConfiguredError,
  effectiveCommissionBps,
  platformCommissionBps,
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
