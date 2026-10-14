import { describe, expect, test } from 'vitest'
import { InvalidAmountError, assertPesewas, cedisToPesewas, formatPesewas, isPesewas } from '../money'

describe('cedisToPesewas', () => {
  test('converts whole and fractional cedis without float error', () => {
    expect(cedisToPesewas('1')).toBe(100)
    expect(cedisToPesewas('1.5')).toBe(150)
    expect(cedisToPesewas('0.1')).toBe(10)
    expect(cedisToPesewas('19.99')).toBe(1999)
    expect(cedisToPesewas(0.07)).toBe(7)
    expect(cedisToPesewas('1,000.00')).toBe(100000)
  })

  test('rejects fractions of a pesewa, negatives and junk', () => {
    expect(() => cedisToPesewas('1.005')).toThrow(InvalidAmountError)
    expect(() => cedisToPesewas('-1')).toThrow(InvalidAmountError)
    expect(() => cedisToPesewas('abc')).toThrow(InvalidAmountError)
    expect(() => cedisToPesewas('')).toThrow(InvalidAmountError)
    expect(() => cedisToPesewas(NaN)).toThrow(InvalidAmountError)
  })

  test('rejects amounts that would leave the safe integer range', () => {
    expect(() => cedisToPesewas('99999999999999999999')).toThrow(InvalidAmountError)
    expect(cedisToPesewas('90071992547409.91')).toBe(9007199254740991)
  })
})

describe('formatPesewas', () => {
  test('formats with two decimals', () => {
    expect(formatPesewas(150)).toBe('GHS 1.50')
    expect(formatPesewas(5)).toBe('GHS 0.05')
    expect(formatPesewas(100000)).toBe('GHS 1000.00')
  })

  test('refuses non-integer input', () => {
    expect(() => formatPesewas(1.5)).toThrow(InvalidAmountError)
  })
})

describe('isPesewas / assertPesewas', () => {
  test('accepts non-negative safe integers only', () => {
    expect(isPesewas(0)).toBe(true)
    expect(isPesewas(100)).toBe(true)
    expect(isPesewas(-1)).toBe(false)
    expect(isPesewas(1.5)).toBe(false)
    expect(isPesewas('100')).toBe(false)
    expect(() => assertPesewas(2.5)).toThrow(InvalidAmountError)
  })
})
