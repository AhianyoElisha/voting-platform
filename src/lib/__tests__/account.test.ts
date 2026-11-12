import { describe, expect, it } from 'vitest'
import { AccountError, parseFullName } from '../account-server'

describe('account name', () => {
  it('trims and collapses spaces', () => {
    expect(parseFullName('  Ama   Owusu ')).toBe('Ama Owusu')
  })

  it('refuses names that are too short, too long or not text', () => {
    for (const bad of ['', ' a ', undefined, 42, null]) {
      expect(() => parseFullName(bad)).toThrow(AccountError)
    }
    expect(() => parseFullName('x'.repeat(121))).toThrow(/nameTooLong/)
    expect(parseFullName('x'.repeat(120))).toHaveLength(120)
  })
})
