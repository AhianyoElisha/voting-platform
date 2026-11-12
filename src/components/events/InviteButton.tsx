'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Invite a nominee to the portal. When the email could not be sent (Resend
 * unconfigured or failing, #32) the route returns the claim link and it is shown here for the organizer to
 * copy and send another way.
 */
export default function InviteButton({
  orgId,
  eventId,
  nomineeId,
  hasEmail,
  state,
}: {
  orgId: string
  eventId: string
  nomineeId: string
  hasEmail: boolean
  state: 'none' | 'sent' | 'claimed'
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  if (state === 'claimed')
    return <span className="text-xs text-green-600">{t('web:events.nominees.inviteState.claimed')}</span>
  if (!hasEmail) return <span className="text-xs text-neutral-400">{t('web:events.nominees.inviteState.none')}</span>

  const invite = async () => {
    setBusy(true)
    setError('')
    setLink(null)
    setNotice('')
    try {
      const out = await postJson<{ mode: 'claim' | 'existing'; emailSent: boolean; claimUrl: string | null }>(
        `/api/orgs/${orgId}/events/${eventId}/nominees/${nomineeId}/invite`,
        {}
      )
      if (out.mode === 'existing') setNotice(t('web:events.nominees.inviteState.existing'))
      else if (!out.emailSent && out.claimUrl) setLink(out.claimUrl)
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable: the link is visible to select */
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {state === 'sent' && (
          <span className="text-xs text-primary-600">{t('web:events.nominees.inviteState.sent')}</span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void invite()}
          className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
        >
          {busy
            ? t('web:events.nominees.inviting')
            : state === 'sent'
              ? t('web:events.nominees.reinvite')
              : t('web:events.nominees.invite')}
        </button>
      </div>
      {link && (
        <div className="max-w-xs rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-700 dark:bg-amber-900/20">
          <p className="text-amber-800 dark:text-amber-300">{t('web:events.nominees.inviteLink.title')}</p>
          <p className="mt-1 font-mono break-all text-neutral-800 select-all dark:text-neutral-200">{link}</p>
          <button type="button" onClick={() => void copy()} className="mt-1 font-medium underline">
            {copied ? t('web:events.nominees.inviteLink.copied') : t('web:events.nominees.inviteLink.copy')}
          </button>
        </div>
      )}
      {notice && <p className="max-w-xs text-xs text-green-700 dark:text-green-400">{notice}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
