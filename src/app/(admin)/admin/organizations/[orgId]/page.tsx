import AuditTable from '@/components/admin/AuditTable'
import OrganizationSettingsForm from '@/components/admin/OrganizationSettingsForm'
import TransactionsTable from '@/components/admin/TransactionsTable'
import { Empty, TableWrap, td, th } from '@/components/admin/ui'
import { adminMetadata, formatWhen, requireAdminPage } from '@/lib/admin-page'
import { AdminError, getOrganizationDetail, listAuditPage, listTransactionsPage, userNames } from '@/lib/admin-server'
import { platformCommissionBps } from '@/lib/fees'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import { Badge } from '@/shared/Badge'
import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata('web:admin.nav.organizations')
}

type Props = { params: Promise<{ orgId: string }> }

export default async function AdminOrganizationPage({ params }: Props) {
  const { orgId } = await params
  await requireAdminPage(`/admin/organizations/${orgId}`)
  const { t } = await getTranslations()
  let detail
  try {
    detail = await getOrganizationDetail(orgId)
  } catch (err) {
    if (err instanceof AdminError || (err as { code?: number })?.code === 404) notFound()
    throw err
  }
  const [payments, audit] = await Promise.all([
    listTransactionsPage({ organizationId: orgId }),
    listAuditPage({ organizationId: orgId }),
  ])
  const actors = await userNames(audit.items.map((r) => r.actorId))
  const { organization: o, balance } = detail
  let platformRate: string
  try {
    platformRate = String(platformCommissionBps() / 100)
  } catch {
    platformRate = '?'
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link href="/admin/organizations" className="text-sm text-neutral-500 underline">
          ← {t('web:admin.nav.organizations')}
        </Link>
        <h2 className="flex flex-wrap items-center gap-3 text-2xl font-semibold text-neutral-900 dark:text-white">
          {o.name}
          <Badge color={o.status === 'active' ? 'green' : 'red'}>{t(`web:dashboard.status.${o.status}`)}</Badge>
        </h2>
        <p className="text-sm text-neutral-500">
          /o/{o.slug} · {t('web:admin.orgs.col.created')} {formatWhen(o.$createdAt)} ·{' '}
          {t('web:admin.org.members', { count: detail.members })}
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {t('web:admin.org.owners')}: {detail.owners.map((u) => `${u.name} <${u.email}>`).join(', ') || '—'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <OrganizationSettingsForm
          orgId={o.$id}
          platformRate={platformRate}
          initial={{
            status: o.status,
            commissionRate: o.commissionRate ?? null,
            moraleCandidatesEnabled: o.moraleCandidatesEnabled,
            freeVotesEnabled: o.freeVotesEnabled,
          }}
        />
        <section className="space-y-2 surface p-4 text-sm">
          <h2 className="font-semibold text-neutral-900 dark:text-white">{t('web:admin.org.balance')}</h2>
          <p>
            {t('web:admin.org.credits')}: <strong>{formatPesewas(balance.credits)}</strong>
          </p>
          <p>
            {t('web:admin.org.paidOut')}: <strong>{formatPesewas(-balance.debits)}</strong>
          </p>
          <p>
            {t('web:admin.org.reserved')}: <strong>{formatPesewas(balance.reserved)}</strong>
          </p>
          <p>
            {t('web:admin.org.available')}: <strong>{formatPesewas(balance.available)}</strong>
          </p>
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="section-title">{t('web:admin.org.events')}</h2>
        {detail.events.length === 0 ? (
          <Empty>{t('web:admin.payouts.none')}</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>{t('web:admin.org.event')}</th>
                <th className={th}>{t('web:admin.orgs.col.status')}</th>
                <th className={th}>{t('web:admin.orgs.col.created')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {detail.events.map((e) => (
                <tr key={e.$id}>
                  <td className={td}>
                    <Link href={`/o/${o.slug}/${e.slug}`} className="underline">
                      {e.title}
                    </Link>
                  </td>
                  <td className={td}>{t(`web:events.status.${e.status}`)}</td>
                  <td className={td}>{formatWhen(e.$createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="section-title">{t('web:admin.nav.transactions')}</h2>
          <Link href={`/admin/transactions?org=${o.$id}`} className="text-sm underline">
            {t('web:admin.seeAll')}
          </Link>
        </div>
        {payments.items.length === 0 ? (
          <Empty>{t('web:admin.payouts.none')}</Empty>
        ) : (
          <TransactionsTable items={payments.items} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="section-title">{t('web:admin.nav.audit')}</h2>
          <Link href={`/admin/audit?org=${o.$id}`} className="text-sm underline">
            {t('web:admin.seeAll')}
          </Link>
        </div>
        {audit.items.length === 0 ? (
          <Empty>{t('web:admin.payouts.none')}</Empty>
        ) : (
          <AuditTable items={audit.items} actors={actors} />
        )}
      </section>
    </div>
  )
}
