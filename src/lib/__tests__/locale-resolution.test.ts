import { describe, expect, test } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  NAMESPACES,
  localeFromAcceptLanguage,
  negotiateLocale,
  normalizeLocale,
} from '../i18n-config'
import { getTranslationsForLocale } from '../i18n-server'
import { getResources } from '../i18n-catalog'

/**
 * English only for now (ARCHITECTURE.md), with pickLT's negotiation kept so a
 * second locale is a catalog plus one line in LOCALES.
 */
describe('locale config', () => {
  test('ships en only, with every namespace in the catalog', () => {
    expect([...LOCALES]).toEqual(['en'])
    expect(DEFAULT_LOCALE).toBe('en')
    for (const l of LOCALES) expect(LOCALE_NAMES[l]).toBeTruthy()
    const en = getResources('en').en as Record<string, unknown>
    for (const ns of NAMESPACES) expect(en[ns]).toBeTypeOf('object')
  })

  test('normalizes region variants and rejects unknown languages', () => {
    expect(normalizeLocale('en-GB')).toBe('en')
    expect(normalizeLocale('EN')).toBe('en')
    expect(normalizeLocale('tw')).toBeNull()
    expect(normalizeLocale(undefined)).toBeNull()
  })

  test('falls back to en whatever the browser asks for', () => {
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9')).toBeNull()
    expect(negotiateLocale(null, 'de-DE,de;q=0.9')).toBe('en')
    expect(negotiateLocale(null, null)).toBe('en')
    expect(negotiateLocale('en', 'fr')).toBe('en')
  })

  test('server translations resolve real keys', () => {
    const { t, locale } = getTranslationsForLocale('en')
    expect(locale).toBe('en')
    expect(t('common:action.continue.cta')).toBe('Continue')
    expect(t('web:seo.titleTemplate')).toContain('voteapp')
  })
})
