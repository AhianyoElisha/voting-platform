'use client'

import { inputClass } from '@/components/organization/OrganizationFields'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function FontUploadForm({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const [family, setFamily] = useState('')
  const [weight, setWeight] = useState('700')
  const [style, setStyle] = useState('normal')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('family', family)
      form.append('weight', weight)
      form.append('style', style)
      const res = await fetch(`/api/orgs/${orgId}/fonts`, { method: 'POST', body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'upload failed')
      setFamily('')
      setFile(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors:auth.unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 text-xs">
      <label>
        {t('web:flyer.fonts.family')}
        <input
          value={family}
          onChange={(e) => setFamily(e.target.value)}
          required
          maxLength={80}
          className={`${inputClass} py-1.5 text-xs`}
          placeholder="Bebas Neue"
        />
      </label>
      <label>
        {t('web:flyer.fonts.weight')}
        <select
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className={`${inputClass} w-auto py-1.5 text-xs`}
        >
          {[300, 400, 500, 600, 700, 800, 900].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('web:flyer.fonts.style')}
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          className={`${inputClass} w-auto py-1.5 text-xs`}
        >
          <option value="normal">normal</option>
          <option value="italic">italic</option>
        </select>
      </label>
      <input
        type="file"
        accept=".ttf,.otf,font/ttf,font/otf"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="text-xs"
        aria-label={t('web:flyer.fonts.file')}
      />
      <button
        type="submit"
        disabled={busy || !file || !family}
        className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? t('web:flyer.fonts.uploading') : t('web:flyer.fonts.upload')}
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </form>
  )
}
