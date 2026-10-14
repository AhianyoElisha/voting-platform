import { CancelPayoutButton } from '@/components/payouts/PayoutActions'
import PayoutRequestForm from '@/components/payouts/PayoutRequestForm'
import { getTranslations } from '@/lib/i18n-server'
import { balanceFor, listLedger } from '@/lib/ledger-server'
import { formatPesewas } from '@/lib/money'
import { resolveWorkspace } from '@/lib/page-tenant'
import { listPayouts } from '@/lib/payouts-server'
import { canManage } from '@/lib/tenant'
import { Heading } from '@/shared/Heading'
import Link from 'next/link'

type Props = { params: Promise<{ orgSlug: string }> }

export default async function PayoutsPage({ params }: Props) {
  const { orgSlug } = await params
  const { ctx, organization } = await resolveWorkspace(orgSlug, `/dashboard/${orgSlug}/payouts`)
  const { t } = await getTranslations()
  const [balance, payouts, ledger] = await Promise.all([balanceFor(ctx), listPayouts(ctx), listLedger(ctx)])
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Accra' }) : '')

  return (
    <main className="container space-y-10 py-16 lg:py-24">
      <div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          <Link href="/dashboard" className="underline">
            {t('web:dashboard.title')}
          </Link>{' '}
          / {organization.name}
        </p>
        <Heading>{t('web:payouts.title')}</Heading>
        <dl className="mt-4 grid gap-4 sm:grid-cols-4">
          {(
            [
              ['credits', formatPesewas(balance.credits)],
              ['paidOut', formatPesewas(-balance.debits)],
              ['reserved', formatPesewas(balance.reserved)],
              ['available', formatPesewas(balance.available)],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-700">
              <dt className="text-xs text-neutral-500 uppercase dark:text-neutral-400">
                {t(`web:payouts.balance.${key}`)}
              </dt>
              <dd className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {canManage(ctx.role) && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:payouts.request')}</h2>
          <p className="max-w-xl text-sm text-neutral-500 dark:text-neutral-400">{t('web:payouts.howItWorks')}</p>
          <PayoutRequestForm orgId={organization.$id} availableLabel={formatPesewas(balance.available)} />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{t('web:payouts.history')}</h2>
        {payouts.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:payouts.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500 uppercase dark:text-neutral-400">
              <tr>
                <th className="px-3 py-2">{t('web:payouts.col.requested')}</th>
                <th className="px-3 py-2">{t('web:payouts.col.amount')}</th>
                <th className="px-3 py-2">{t('web:payouts.col.destination')}</th>
                <th className="px-3 py-2">{t('web:payouts.col.status')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {payouts.map((p) => {
                const d = JSON.parse(p.destination) as Record<string, string>
                return (
                  <tr key={p.$id}>
                    <td className="px-3 py-2">{fmt(p.$createdAt)}</td>
                    <td className="px-3 py-2 font-medium text-neutral-900 dark:text-white">
                      {formatPesewas(p.amount)}
                    </td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                      {p.destinationKind === 'momo' ? `${d.name} · ${d.phone}` : `${d.bankName} · ${d.accountNumber}`}
                    </td>
                    <td className="px-3 py-2">
                      {t(`web:payouts.status.${p.status}`)}
                      {p.note ? <span className="block text-xs text-neutral-500">{p.note}</span> : null}
                      {p.paidAt ? <span className="block text-xs text-neutral-500">{fmt(p.paidAt)}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {p.status === 'requested' && canManage(ctx.role) && (
                        <CancelPayoutButton orgId={organization.$id} payoutId={p.$id} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <details>
        <summary className="cursor-pointer text-sm font-medium text-primary-600 dark:text-primary-400">
          {t('web:payouts.ledger')} ({ledger.length})
        </summary>
        <ul className="mt-2 space-y-1 text-xs text-neutral-600 dark:text-neutral-300">
          {ledger.slice(0, 200).map((e) => (
            <li key={e.$id}>
              {fmt(e.$createdAt)} · {t(`web:payouts.entry.${e.type}`)} · {formatPesewas(Math.abs(e.amount))}
              {e.amount < 0 ? ' (out)' : ''}
            </li>
          ))}
        </ul>
      </details>
    </main>
  )
}
