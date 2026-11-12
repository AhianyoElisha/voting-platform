import AuditTable from '@/components/admin/AuditTable'
import { Empty, NextPage } from '@/components/admin/ui'
import { adminMetadata, param, requireAdminPage } from '@/lib/admin-page'
import { listAuditPage, organizationNames, userNames } from '@/lib/admin-server'
import { getTranslations } from '@/lib/i18n-server'
import { Metadata } from 'next'
import Link from 'next/link'

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata('web:admin.nav.audit')
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** The audit trail across every organization, newest first. */
export default async function AdminAuditPage({ searchParams }: Props) {
  await requireAdminPage('/admin/audit')
  const { t } = await getTranslations()
  const sp = await searchParams
  const org = param(sp.org)
  const page = await listAuditPage({ organizationId: org || undefined }, param(sp.after) || null)
  const [actors, names] = await Promise.all([
    userNames(page.items.map((r) => r.actorId)),
    organizationNames([...page.items.map((r) => r.organizationId), org || null]),
  ])
  return (
    <div className="space-y-4">
      {org && (
        <p className="text-sm text-neutral-500">
          {t('web:admin.tx.forOrg', { name: names.get(org) ?? org })} ·{' '}
          <Link href="/admin/audit" className="underline">
            {t('web:admin.clearFilter')}
          </Link>
        </p>
      )}
      {page.items.length === 0 ? (
        <Empty>{t('web:admin.payouts.none')}</Empty>
      ) : (
        <AuditTable items={page.items} actors={actors} orgNames={names} />
      )}
      <NextPage next={page.next} base="/admin/audit" params={{ org }} label={t('web:admin.nextPage')} />
    </div>
  )
}
