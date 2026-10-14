'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function AcceptInvite({ token }: { token: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            const out = await postJson<{ organization: { slug: string | null } }>('/api/team/accept', { token })
            router.push(out.organization.slug ? `/dashboard/${out.organization.slug}/events` : '/dashboard')
          } catch (err) {
            setError(apiErrorMessage(err, t('errors:auth.unknown')))
            setBusy(false)
          }
        }}
        className="w-full rounded-xl bg-primary-600 px-4 py-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
      >
        {busy ? t('web:team.accept.joining') : t('web:team.accept.join')}
      </button>
      {error && <p className="text-center text-sm text-red-600">{error}</p>}
    </div>
  )
}
