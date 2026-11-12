import { AdminPayoutActions } from '@/components/payouts/PayoutActions'
import { adminMetadata, requireAdminPage } from '@/lib/admin-page'
import { createAdminClient, withRetry } from '@/lib/appwrite-server'
import { APPWRITE } from '@/lib/constants'
import { databaseId } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import { listAllPayouts } from '@/lib/payouts-server'
import type { OrganizationDoc } from '@/lib/types'
import { Metadata } from 'next'
import { Query } from 'node-appwrite'

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata('web:admin.nav.payouts')
}

/** Super admin console (PRD 5.7): payout requests from every organizer. */
export default async function AdminPayoutsPage() {
  await requireAdminPage('/admin/payouts')
  const { t } = await getTranslations()
  const [pending, settled] = await Promise.all([
    listAllPayouts(['requested', 'approved']),
    listAllPayouts(['paid', 'rejected']),
  ])
  const all = [...pending, ...settled]
  const orgIds = [...new Set(all.map((p) => p.organizationId))]
  const { databases } = createAdminClient()
  const orgs = orgIds.length
    ? await withRetry(() =>
        databases.listDocuments<OrganizationDoc>(databaseId(), APPWRITE.TABLES.ORGANIZATIONS, [
          Query.equal('$id', orgIds),
          Query.limit(100),
        ])
      )
    : { documents: [] as OrganizationDoc[] }
  const name = new Map(orgs.documents.map((o) => [o.$id, o.name]))
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Accra' }) : '')

  const table = (rows: typeof all, withActions: boolean) => (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-neutral-500 uppercase dark:text-neutral-400">
        <tr>
          <th className="px-3 py-2">{t('web:admin.payouts.col.org')}</th>
          <th className="px-3 py-2">{t('web:payouts.col.requested')}</th>
          <th className="px-3 py-2">{t('web:payouts.col.amount')}</th>
          <th className="px-3 py-2">{t('web:payouts.col.destination')}</th>
          <th className="px-3 py-2">{t('web:payouts.col.status')}</th>
          {withActions && <th className="px-3 py-2"></th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
        {rows.map((p) => {
          const d = JSON.parse(p.destination) as Record<string, string>
          return (
            <tr key={p.$id}>
              <td className="px-3 py-2 font-medium text-neutral-900 dark:text-white">
                {name.get(p.organizationId) ?? p.organizationId}
              </td>
              <td className="px-3 py-2">{fmt(p.$createdAt)}</td>
              <td className="px-3 py-2">{formatPesewas(p.amount)}</td>
              <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                {p.destinationKind === 'momo'
                  ? `MoMo · ${d.name} · ${d.phone}`
                  : `${d.bankName} · ${d.accountNumber} · ${d.accountName}`}
              </td>
              <td className="px-3 py-2">
                {t(`web:payouts.status.${p.status}`)}
                {p.note ? <span className="block text-xs text-neutral-500">{p.note}</span> : null}
              </td>
              {withActions && (
                <td className="px-3 py-2">
                  <AdminPayoutActions payoutId={p.$id} status={p.status} />
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <div className="space-y-10">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:admin.payouts.intro')}</p>
      <section className="space-y-3">
        <h2 className="section-title">{t('web:admin.payouts.pending')}</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:admin.payouts.none')}</p>
        ) : (
          table(pending, true)
        )}
      </section>
      <section className="space-y-3">
        <h2 className="section-title">{t('web:admin.payouts.settled')}</h2>
        {settled.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:admin.payouts.none')}</p>
        ) : (
          table(settled.slice(0, 100), false)
        )}
      </section>
    </div>
  )
}
