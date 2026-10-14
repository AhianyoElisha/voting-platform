'use client'

import { SLUG_MAX, slugify } from '@/lib/slug'
import { useTranslation } from 'react-i18next'

export const inputClass =
  'w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 placeholder-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder-neutral-500'

export interface OrganizationFieldsValue {
  name: string
  slug: string
  /** True once the user has edited the slug by hand; the name stops driving it. */
  slugTouched: boolean
}

export const emptyOrganizationFields: OrganizationFieldsValue = { name: '', slug: '', slugTouched: false }

/**
 * Organization name plus its derived, editable slug. Shared by the signup page
 * and the dashboard's create-workspace form, so both collect exactly what
 * `POST /api/organizations` validates.
 */
export default function OrganizationFields({
  value,
  onChange,
  idPrefix = 'org',
}: {
  value: OrganizationFieldsValue
  onChange: (next: OrganizationFieldsValue) => void
  idPrefix?: string
}) {
  const { t } = useTranslation()
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const prefix = `${origin}/o/${value.slug || '…'}`

  return (
    <>
      <div>
        <label
          htmlFor={`${idPrefix}-name`}
          className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
        >
          {t('web:signup.organization.label')}
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={value.name}
          onChange={(e) => {
            const name = e.target.value
            onChange({ ...value, name, slug: value.slugTouched ? value.slug : slugify(name) })
          }}
          required
          maxLength={120}
          autoComplete="organization"
          className={inputClass}
          placeholder={t('web:signup.organization.placeholder')}
        />
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('web:signup.organization.helper')}</p>
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-slug`}
          className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
        >
          {t('web:signup.slug.label')}
        </label>
        <input
          id={`${idPrefix}-slug`}
          type="text"
          value={value.slug}
          onChange={(e) => onChange({ ...value, slug: e.target.value.toLowerCase(), slugTouched: true })}
          required
          maxLength={SLUG_MAX}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <p className="mt-1 text-xs break-all text-neutral-500 dark:text-neutral-400">
          {t('web:signup.slug.helper', { prefix })}
        </p>
      </div>
    </>
  )
}

export type OrganizationApiError = { error?: string; code?: string }

/** Maps the route's `{ code }` to a translated message; falls back to the generic one. */
export function organizationErrorMessage(t: (key: string) => string, body: OrganizationApiError | null): string {
  if (body?.code) return t(`errors:organization.${body.code}`)
  return t('errors:organization.createFailed')
}
