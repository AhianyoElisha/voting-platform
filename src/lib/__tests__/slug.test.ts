import { describe, expect, test } from 'vitest'
import { SLUG_MAX, isValidSlug, slugify, validateSlug } from '../slug'

describe('slugify', () => {
  test('lowercases and hyphenates words', () => {
    expect(slugify('Faculty of Social Sciences')).toBe('faculty-of-social-sciences')
  })

  test('strips diacritics and punctuation', () => {
    expect(slugify("Département d'Économie & Finance!")).toBe('departement-d-economie-finance')
  })

  test('collapses runs of separators and trims the ends', () => {
    expect(slugify('  --Unity   Hall-- ')).toBe('unity-hall')
  })

  test('truncates to the maximum without a trailing hyphen', () => {
    const long = Array.from({ length: 20 }, () => 'abc').join(' ')
    const slug = slugify(long)
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX)
    expect(slug.endsWith('-')).toBe(false)
  })

  test('returns an empty string when nothing survives', () => {
    expect(slugify('!!!')).toBe('')
  })
})

describe('validateSlug', () => {
  test('accepts a plain slug', () => {
    expect(validateSlug('knust-src')).toBeNull()
    expect(isValidSlug('knust-src')).toBe(true)
  })

  test('rejects short, long, malformed and reserved slugs', () => {
    expect(validateSlug('ab')).toBe('tooShort')
    expect(validateSlug('a'.repeat(SLUG_MAX + 1))).toBe('tooLong')
    expect(validateSlug('Unity Hall')).toBe('invalid')
    expect(validateSlug('-unity')).toBe('invalid')
    expect(validateSlug('unity--hall')).toBe('invalid')
    expect(validateSlug('admin')).toBe('reserved')
    expect(validateSlug('api')).toBe('reserved')
  })
})
