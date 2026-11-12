import { Empty, NextPage, TableWrap, buttonClass, fieldClass, selectClass, td, th } from '@/components/admin/ui'
import { adminMetadata, formatWhen, param, requireAdminPage } from '@/lib/admin-page'
import { listOrganizationsPage } from '@/lib/admin-server'
import { getTranslations } from '@/lib/i18n-server'
import type { OrganizationStatus } from '@/lib/types'
import { Badge } from '@/shared/Badge'
import { Metadata } from 'next'
import Link from 'next/link'

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata('web:admin.nav.organizations')
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function AdminOrganizationsPage({ searchParams }: Props) {
  await requireAdminPage('/admin/organizations')
  const { t } = await getTranslations()
  const sp = await searchParams
  const q = param(sp.q)
  const statusParam = param(sp.status)
  const status =
    statusParam === 'active' || statusParam === 'suspended' ? (statusParam as OrganizationStatus) : undefined
  const page = await listOrganizationsPage({ status, search: q }, param(sp.after) || null)

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-center gap-2" method="get">
        <input name="q" defaultValue={q} placeholder={t('web:admin.orgs.search')} className={fieldClass} />
        <select name="status" defaultValue={status ?? ''} className={selectClass}>
          <option value="">{t('web:admin.orgs.anyStatus')}</option>
          <option value="active">{t('web:dashboard.status.active')}</option>
          <option value="suspended">{t('web:dashboard.status.suspended')}</option>
        </select>
        <button className={buttonClass}>{t('web:admin.filter')}</button>
      </form>
      {page.items.length === 0 ? (
        <Empty>{t('web:admin.payouts.none')}</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>{t('web:admin.orgs.col.name')}</th>
              <th className={th}>{t('web:admin.orgs.col.status')}</th>
              <th className={th}>{t('web:admin.orgs.col.commission')}</th>
              <th className={th}>{t('web:admin.orgs.col.switches')}</th>
              <th className={th}>{t('web:admin.orgs.col.created')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {page.items.map((o) => (
              <tr key={o.$id}>
                <td className={td}>
                  <Link
                    href={`/admin/organizations/${o.$id}`}
                    className="font-medium text-neutral-900 underline dark:text-white"
                  >
                    {o.name}
                  </Link>
                  <span className="block text-xs text-neutral-500">/o/{o.slug}</span>
                </td>
                <td className={td}>
                  <Badge color={o.status === 'active' ? 'green' : 'red'}>{t(`web:dashboard.status.${o.status}`)}</Badge>
                </td>
                <td className={td}>
                  {o.commissionRate === null || o.commissionRate === undefined
                    ? t('web:admin.orgs.platformRate')
                    : `${o.commissionRate / 100}%`}
                </td>
                <td className={`${td} text-xs text-neutral-600 dark:text-neutral-300`}>
                  {t('web:admin.settings.morale')}: {o.moraleCandidatesEnabled ? t('web:admin.on') : t('web:admin.off')}
                  <br />
                  {t('web:admin.settings.freeVotes')}: {o.freeVotesEnabled ? t('web:admin.on') : t('web:admin.off')}
                </td>
                <td className={td}>{formatWhen(o.$createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <NextPage
        next={page.next}
        base="/admin/organizations"
        params={{ q, status: status ?? '' }}
        label={t('web:admin.nextPage')}
      />
    </div>
  )
}
