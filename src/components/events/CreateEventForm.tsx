'use client'

import { inputClass } from '@/components/organization/OrganizationFields'
import { slugify } from '@/lib/slug'
import { RESULTS_VISIBILITIES } from '@/lib/types'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiErrorMessage, postJson } from './api'

const labelClass = 'mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300'
const helpClass = 'mt-1 text-xs text-neutral-500 dark:text-neutral-400'

/** Local `datetime-local` value → ISO string. Africa/Accra is UTC, but we convert properly anyway. */
function toIso(local: string): string {
  return local ? new Date(local).toISOString() : ''
}

export default function CreateEventForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [visibility, setVisibility] = useState('')
  const [morale, setMorale] = useState(false)
  const [freeVotes, setFreeVotes] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const { event } = await postJson<{ event: { $id: string } }>(`/api/orgs/${orgId}/events`, {
        title,
        slug,
        description,
        votePriceCedis: price,
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
        resultsVisibility: visibility,
        moraleCandidatesEnabled: morale,
        freeVotesEnabled: freeVotes,
      })
      router.push(`/dashboard/${orgSlug}/events/${event.$id}`)
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
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

      <div>
        <label htmlFor="ev-title" className={labelClass}>
          {t('web:events.form.title.label')}
        </label>
        <input
          id="ev-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            if (!slugTouched) setSlug(slugify(e.target.value))
          }}
          required
          maxLength={120}
          className={inputClass}
          placeholder={t('web:events.form.title.placeholder')}
        />
      </div>

      <div>
        <label htmlFor="ev-slug" className={labelClass}>
          {t('web:events.form.slug.label')}
        </label>
        <input
          id="ev-slug"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value.toLowerCase())
            setSlugTouched(true)
          }}
          required
          maxLength={48}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <p className={`${helpClass} break-all`}>
          {t('web:events.form.slug.helper', { path: `/o/${orgSlug}/${slug || '…'}` })}
        </p>
      </div>

      <div>
        <label htmlFor="ev-desc" className={labelClass}>
          {t('web:events.form.description.label')}
        </label>
        <textarea
          id="ev-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="ev-price" className={labelClass}>
          {t('web:events.form.price.label')}
        </label>
        <input
          id="ev-price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
          inputMode="decimal"
          pattern="\d+(\.\d{1,2})?"
          className={inputClass}
          placeholder="1.00"
        />
        <p className={helpClass}>{t('web:events.form.price.helper')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ev-start" className={labelClass}>
            {t('web:events.form.startsAt.label')}
          </label>
          <input
            id="ev-start"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ev-end" className={labelClass}>
            {t('web:events.form.endsAt.label')}
          </label>
          <input
            id="ev-end"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="ev-vis" className={labelClass}>
          {t('web:events.form.visibility.label')}
        </label>
        <select
          id="ev-vis"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          required
          className={inputClass}
        >
          <option value="" disabled>
            {t('web:events.form.visibility.placeholder')}
          </option>
          {RESULTS_VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {t(`web:events.visibility.${v}`)}
            </option>
          ))}
        </select>
        <p className={helpClass}>{t('web:events.form.visibility.helper')}</p>
      </div>

      <label className="flex items-start gap-3 text-sm text-neutral-700 dark:text-neutral-300">
        <input
          type="checkbox"
          checked={morale}
          onChange={(e) => setMorale(e.target.checked)}
          className="mt-1 rounded border-neutral-300"
        />
        <span>
          {t('web:events.form.morale.label')}
          <span className={`${helpClass} block`}>{t('web:events.form.morale.helper')}</span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm text-neutral-700 dark:text-neutral-300">
        <input
          type="checkbox"
          checked={freeVotes}
          onChange={(e) => setFreeVotes(e.target.checked)}
          className="mt-1 rounded border-neutral-300"
        />
        <span>
          {t('web:events.form.freeVotes.label')}
          <span className={`${helpClass} block`}>{t('web:events.form.freeVotes.helper')}</span>
        </span>
      </label>

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex w-full items-center justify-center gap-2 rounded-xl btn-brand px-4 py-3 text-sm font-medium disabled:opacity-50"
      >
        {isSubmitting ? t('web:events.form.submitting') : t('web:events.form.submit')}
        {!isSubmitting && <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.5} />}
      </button>
    </form>
  )
}
