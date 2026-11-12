'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The one-time code step some networks require before the MoMo prompt
 * (Paystack's `send_otp`). Shared by the vote and ticket forms. Submitting it
 * only continues the charge; the page still waits for the confirmed status.
 */
export default function OtpEntry({
  paymentId,
  onSubmitted,
}: {
  paymentId: string
  onSubmitted: (next: { instructions: string | null; nextAction: 'otp' | null }) => void
}) {
  const { t } = useTranslation()
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await postJson<{ instructions: string | null; nextAction: 'otp' | null }>(
        `/api/public/payments/${paymentId}/otp`,
        { otp }
      )
      setOtp('')
      onSubmitted(data)
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 text-left">
      <label className="block text-sm font-medium text-neutral-800 dark:text-neutral-200" htmlFor="payment-otp">
        {t('web:vote.otp.label')}
      </label>
      <div className="flex gap-2">
        <input
          id="payment-otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{4,8}"
          required
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={busy || otp.length < 4}
          className="shrink-0 rounded-xl btn-brand px-4 py-2 text-sm font-medium"
        >
          {busy ? t('web:vote.otp.sending') : t('web:vote.otp.submit')}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
