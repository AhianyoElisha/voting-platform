import { TableWrap, td, th } from '@/components/admin/ui'
import { formatWhen } from '@/lib/admin-page'
import type { TransactionView } from '@/lib/admin-server'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import { Badge } from '@/shared/Badge'
import Link from 'next/link'

const statusColor = { success: 'green', pending: 'amber', failed: 'red', refunded: 'zinc' } as const

/** Payments across organizations. The payer number is already masked (#28). */
export default async function TransactionsTable({
  items,
  orgNames,
}: {
  items: TransactionView[]
  orgNames?: Map<string, string>
}) {
  const { t } = await getTranslations()
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>{t('web:admin.tx.col.when')}</th>
          {orgNames && <th className={th}>{t('web:admin.payouts.col.org')}</th>}
          <th className={th}>{t('web:admin.tx.col.what')}</th>
          <th className={th}>{t('web:admin.tx.col.amount')}</th>
          <th className={th}>{t('web:admin.tx.col.payer')}</th>
          <th className={th}>{t('web:admin.tx.col.status')}</th>
          <th className={th}>{t('web:admin.tx.col.reference')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
        {items.map((p) => (
          <tr key={p.id}>
            <td className={td}>{formatWhen(p.createdAt)}</td>
            {orgNames && (
              <td className={td}>
                <Link href={`/admin/organizations/${p.organizationId}`} className="underline">
                  {orgNames.get(p.organizationId) ?? p.organizationId}
                </Link>
              </td>
            )}
            <td className={td}>
              {t(`web:admin.tx.purpose.${p.purpose}`, { count: p.quantity })}
              <span className="block text-xs text-neutral-500">
                {p.channel} · {p.provider}
                {p.network ? ` · ${p.network}` : ''}
              </span>
            </td>
            <td className={td}>
              {formatPesewas(p.amount)}
              <span className="block text-xs text-neutral-500">
                {t('web:admin.tx.fee')} {formatPesewas(p.platformFee)}
                {p.providerFee !== null && ` · ${t('web:admin.tx.charge')} ${formatPesewas(p.providerFee)}`}
              </span>
            </td>
            <td className={`${td} font-mono text-xs`}>{p.payerPhone}</td>
            <td className={td}>
              <Badge color={statusColor[p.status]}>{t(`web:admin.tx.status.${p.status}`)}</Badge>
            </td>
            <td className={`${td} font-mono text-xs break-all`}>
              {p.id}
              {p.providerReference !== p.id && <span className="block text-neutral-500">{p.providerReference}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  )
}
