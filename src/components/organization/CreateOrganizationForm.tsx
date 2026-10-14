'use client'

import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OrganizationFields, { emptyOrganizationFields, organizationErrorMessage } from './OrganizationFields'

/**
 * Dashboard form for a signed-in user with no workspace yet (or one who wants
 * another). Posts to `/api/organizations` and refreshes the server-rendered
 * list on success.
 */
export default function CreateOrganizationForm() {
  const { t } = useTranslation()
  const router = useRouter()
  const [fields, setFields] = useState(emptyOrganizationFields)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fields.name, slug: fields.slug }),
      })
      if (!res.ok) {
        setError(organizationErrorMessage(t, await res.json().catch(() => null)))
        return
      }
      setFields(emptyOrganizationFields)
      router.refresh()
    } catch {
      setError(t('errors:organization.createFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <OrganizationFields value={fields} onChange={setFields} idPrefix="dash-org" />

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
      >
        {isSubmitting ? t('web:dashboard.create.submitting') : t('web:dashboard.create.cta')}
        {!isSubmitting && <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.5} />}
      </button>
    </form>
  )
}
