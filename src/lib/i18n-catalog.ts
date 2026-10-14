// One static import per locale/namespace. Add a line here when a namespace or
// locale is added (see src/lib/i18n-config.ts).
//
// SERVER-ONLY-ISH: importing this module pulls every locale's catalog into the
// bundle that imports it. Import it from Server Components, route handlers and
// the root layout only — never from a 'use client' module. Client code receives
// just the active locale's resources as props via I18nProvider.

import type { Resource, ResourceLanguage } from 'i18next'
import en_auth from '../locales/en/auth.json'
import en_common from '../locales/en/common.json'
import en_errors from '../locales/en/errors.json'
import en_web from '../locales/en/web.json'
import { DEFAULT_LOCALE, LOCALES, type Locale } from './i18n-config'

const CATALOG: Record<Locale, ResourceLanguage> = {
  en: { common: en_common, auth: en_auth, errors: en_errors, web: en_web },
}

export function getResources(locale: Locale): Resource {
  if (locale === DEFAULT_LOCALE) {
    return { [DEFAULT_LOCALE]: CATALOG[DEFAULT_LOCALE] }
  }
  return {
    [locale]: CATALOG[locale],
    [DEFAULT_LOCALE]: CATALOG[DEFAULT_LOCALE],
  }
}

/** Every locale's resources. Used by tests / key-parity checks, not by the app. */
export function getAllResources(): Resource {
  return Object.fromEntries(LOCALES.map((l) => [l, CATALOG[l]])) as Resource
}
