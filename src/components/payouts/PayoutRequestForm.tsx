'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

function newKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export default function PayoutRequestForm({ orgId, availableLabel }: { orgId: string; availableLabel: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const [key, setKey] = useState(() => newKey())
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<'momo' | 'bank'>('momo')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setDone('')
    try {
      const destination = kind === 'momo' ? { kind, phone, name } : { kind, bankName, accountNumber, accountName }
      await postJson(`/api/orgs/${orgId}/payouts`, { amountCedis: amount, destination, idempotencyKey: key })
      setDone(t('web:payouts.requested'))
      setAmount('')
      setKey(newKey())
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-3">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        {t('web:payouts.available', { amount: availableLabel })}
      </p>
      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {t('web:payouts.form.amount')}
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          inputMode="decimal"
          pattern="\d+(\.\d{1,2})?"
          className={`${inputClass} mt-1`}
          placeholder="100.00"
        />
      </label>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={kind === 'momo'} onChange={() => setKind('momo')} /> {t('web:payouts.form.momo')}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={kind === 'bank'} onChange={() => setKind('bank')} /> {t('web:payouts.form.bank')}
        </label>
      </div>
      {kind === 'momo' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            className={inputClass}
            placeholder={t('web:payouts.form.phone')}
            aria-label={t('web:payouts.form.phone')}
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputClass}
            placeholder={t('web:payouts.form.name')}
            aria-label={t('web:payouts.form.name')}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            required
            className={inputClass}
            placeholder={t('web:payouts.form.bankName')}
            aria-label={t('web:payouts.form.bankName')}
          />
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            required
            className={inputClass}
            placeholder={t('web:payouts.form.accountNumber')}
            aria-label={t('web:payouts.form.accountNumber')}
          />
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            required
            className={inputClass}
            placeholder={t('web:payouts.form.accountName')}
            aria-label={t('web:payouts.form.accountName')}
          />
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-xl btn-brand px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? t('web:payouts.form.submitting') : t('web:payouts.form.submit')}
      </button>
      {done && <p className="text-sm text-green-600">{done}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
