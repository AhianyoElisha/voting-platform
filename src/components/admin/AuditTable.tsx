import { TableWrap, td, th } from '@/components/admin/ui'
import { formatWhen } from '@/lib/admin-page'
import { getTranslations } from '@/lib/i18n-server'
import type { AuditLogDoc } from '@/lib/types'
import Link from 'next/link'

type Row = Pick<AuditLogDoc, '$id' | '$createdAt' | 'organizationId' | 'actorId' | 'action' | 'target' | 'metadata'>

/** Audit rows, newest first. Metadata is shown as written (it never holds full phone numbers). */
export default async function AuditTable({
  items,
  actors,
  orgNames,
}: {
  items: Row[]
  actors: Map<string, string>
  orgNames?: Map<string, string>
}) {
  const { t } = await getTranslations()
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>{t('web:admin.tx.col.when')}</th>
          {orgNames && <th className={th}>{t('web:admin.payouts.col.org')}</th>}
          <th className={th}>{t('web:admin.audit.col.actor')}</th>
          <th className={th}>{t('web:admin.audit.col.action')}</th>
          <th className={th}>{t('web:admin.audit.col.details')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
        {items.map((r) => (
          <tr key={r.$id}>
            <td className={`${td} whitespace-nowrap`}>{formatWhen(r.$createdAt)}</td>
            {orgNames && (
              <td className={td}>
                {r.organizationId ? (
                  <Link href={`/admin/organizations/${r.organizationId}`} className="underline">
                    {orgNames.get(r.organizationId) ?? r.organizationId}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
            )}
            <td className={td}>{actors.get(r.actorId) ?? r.actorId}</td>
            <td className={`${td} font-mono text-xs`}>
              {r.action}
              <span className="block text-neutral-500">{r.target}</span>
            </td>
            <td className={`${td} max-w-md font-mono text-xs break-all text-neutral-600 dark:text-neutral-300`}>
              {r.metadata ?? ''}
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  )
}
