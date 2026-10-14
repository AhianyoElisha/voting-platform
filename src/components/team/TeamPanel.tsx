'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface MemberView {
  id: string
  userId: string
  role: string
  name: string | null
  email: string | null
}
export interface InviteView {
  id: string
  email: string
  role: string
  status: string
}

const ROLES = ['admin', 'staff', 'designer', 'scanner'] as const
const btn = 'rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50'

export default function TeamPanel({
  orgId,
  members,
  invites,
  me,
  canManage,
}: {
  orgId: string
  members: MemberView[]
  invites: InviteView[]
  me: string
  canManage: boolean
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('staff')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const base = `/api/orgs/${orgId}/team`

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, t('errors:auth.unknown')))
    } finally {
      setBusy(false)
    }
  }
  const invite = (e: FormEvent) => {
    e.preventDefault()
    setLink(null)
    void run(async () => {
      const out = await postJson<{ emailSent: boolean; acceptUrl: string | null }>(base, { email, role })
      if (!out.emailSent && out.acceptUrl) setLink(out.acceptUrl)
      setEmail('')
    })
  }
  const resend = (id: string) =>
    run(async () => {
      const out = await postJson<{ emailSent: boolean; acceptUrl: string | null }>(`${base}/invites/${id}`, {})
      setLink(!out.emailSent && out.acceptUrl ? out.acceptUrl : null)
    })
  const del = (url: string) =>
    run(async () => {
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'failed')
    })

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:team.members')}</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500 uppercase dark:text-neutral-400">
            <tr>
              <th className="px-3 py-2">{t('web:team.col.name')}</th>
              <th className="px-3 py-2">{t('web:team.col.email')}</th>
              <th className="px-3 py-2">{t('web:team.col.role')}</th>
              {canManage && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {members.map((m) => {
              const isMe = m.userId === me
              const locked = isMe || m.role === 'owner'
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2 text-neutral-900 dark:text-white">
                    {m.name ?? '—'}{' '}
                    {isMe ? <span className="text-xs text-neutral-500">({t('web:team.you')})</span> : null}
                  </td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{m.email ?? '—'}</td>
                  <td className="px-3 py-2">
                    {canManage && !locked ? (
                      <select
                        value={m.role}
                        disabled={busy}
                        onChange={(e) =>
                          void run(() =>
                            postJson(`${base}/members/${m.id}`, { role: e.target.value }, 'PATCH').then(() => undefined)
                          )
                        }
                        className={`${inputClass} w-auto py-1 text-xs`}
                        aria-label={t('web:team.col.role')}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`web:dashboard.role.${r}`)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      t(`web:dashboard.role.${m.role}`)
                    )}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2">
                      {!isMe && m.role !== 'owner' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            window.confirm(t('web:team.removeConfirm', { name: m.name ?? m.email ?? '' })) &&
                            void del(`${base}/members/${m.id}`)
                          }
                          className={`${btn} border border-red-300 text-red-700 dark:border-red-700 dark:text-red-300`}
                        >
                          {t('web:team.remove')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {canManage && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:team.invite')}</h2>
          <p className="max-w-xl text-sm text-neutral-500 dark:text-neutral-400">{t('web:team.inviteHelper')}</p>
          <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={`${inputClass} max-w-xs`}
              placeholder={t('web:team.col.email')}
              aria-label={t('web:team.col.email')}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={`${inputClass} w-auto`}
              aria-label={t('web:team.col.role')}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`web:dashboard.role.${r}`)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('web:team.send')}
            </button>
          </form>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('web:team.roleHelp')}</p>
          {link && (
            <div className="max-w-md rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-700 dark:bg-amber-900/20">
              <p className="text-amber-800 dark:text-amber-300">{t('web:team.linkTitle')}</p>
              <p className="mt-1 font-mono break-all text-neutral-800 select-all dark:text-neutral-200">{link}</p>
              <p className="mt-1 text-amber-800 dark:text-amber-300">{t('web:team.linkWarning')}</p>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard
                    .writeText(link)
                    .then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    })
                    .catch(() => {})
                }
                className="mt-1 font-medium underline"
              >
                {copied ? t('web:events.nominees.inviteLink.copied') : t('web:events.nominees.inviteLink.copy')}
              </button>
            </div>
          )}
          {invites.filter((i) => i.status === 'pending').length > 0 && (
            <ul className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200 text-sm dark:divide-neutral-700 dark:border-neutral-700">
              {invites
                .filter((i) => i.status === 'pending')
                .map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                    <span>
                      {i.email} · {t(`web:dashboard.role.${i.role}`)} ·{' '}
                      <span className="text-xs text-neutral-500">{t('web:team.pending')}</span>
                    </span>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void resend(i.id)}
                        className={`${btn} border border-neutral-300 dark:border-neutral-600`}
                      >
                        {t('web:team.resend')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void del(`${base}/invites/${i.id}`)}
                        className={`${btn} border border-neutral-300 dark:border-neutral-600`}
                      >
                        {t('web:team.revoke')}
                      </button>
                    </span>
                  </li>
                ))}
            </ul>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>
      )}
    </div>
  )
}
