import { describe, expect, test } from 'vitest'
import { maskPhone, normalizeGhanaPhone } from '../phone'

describe('maskPhone (#28: only managers see full numbers)', () => {
  test('keeps the last three digits and hides the rest', () => {
    expect(maskPhone('233241234567')).toBe('•••••••••567')
    expect(maskPhone('233241234567')).not.toContain('2412')
  })

  test('handles short and missing values', () => {
    expect(maskPhone('123')).toBe('123')
    expect(maskPhone('')).toBe('')
    expect(maskPhone(null)).toBe('')
  })
})

describe('normalizeGhanaPhone', () => {
  test('accepts local and international forms of a mobile number', () => {
    for (const input of ['024 123 4567', '+233241234567', '233241234567', '241234567'])
      expect(normalizeGhanaPhone(input)).toBe('233241234567')
    expect(normalizeGhanaPhone('0301234567')).toBeNull()
    expect(normalizeGhanaPhone('12345')).toBeNull()
  })
})
