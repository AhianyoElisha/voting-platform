import TransactionsTable from '@/components/admin/TransactionsTable'
import { Empty, NextPage, buttonClass, fieldClass, selectClass } from '@/components/admin/ui'
import { adminMetadata, param, requireAdminPage } from '@/lib/admin-page'
import { findTransaction, listTransactionsPage, organizationNames, type TransactionFilter } from '@/lib/admin-server'
import { getTranslations } from '@/lib/i18n-server'
import type { PaymentPurpose, PaymentStatus } from '@/lib/types'
import { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata('web:admin.nav.transactions')
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const STATUSES: PaymentStatus[] = ['pending', 'success', 'failed', 'refunded']
const PURPOSES: PaymentPurpose[] = ['vote', 'ticket']

/** Every payment on the platform, newest first, or one found by id or provider reference. */
export default async function AdminTransactionsPage({ searchParams }: Props) {
  await requireAdminPage('/admin/transactions')
  const { t } = await getTranslations()
  const sp = await searchParams
  const ref = param(sp.ref)
  const status = STATUSES.find((s) => s === param(sp.status))
  const purpose = PURPOSES.find((p) => p === param(sp.purpose))
  const org = param(sp.org)
  const filter: TransactionFilter = { status, purpose, organizationId: org || undefined }

  const found = ref ? await findTransaction(ref) : null
  const page = ref
    ? { items: found ? [found] : [], next: null }
    : await listTransactionsPage(filter, param(sp.after) || null)
  const names = await organizationNames(page.items.map((p) => p.organizationId))

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-center gap-2" method="get">
        <input name="ref" defaultValue={ref} placeholder={t('web:admin.tx.lookup')} className={`${fieldClass} w-72`} />
        <button className={buttonClass}>{t('web:admin.tx.find')}</button>
      </form>
      <form className="flex flex-wrap items-center gap-2" method="get">
        <select name="status" defaultValue={status ?? ''} className={selectClass}>
          <option value="">{t('web:admin.tx.anyStatus')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`web:admin.tx.status.${s}`)}
            </option>
          ))}
        </select>
        <select name="purpose" defaultValue={purpose ?? ''} className={selectClass}>
          <option value="">{t('web:admin.tx.anyPurpose')}</option>
          {PURPOSES.map((p) => (
            <option key={p} value={p}>
              {t(`web:admin.tx.purposeName.${p}`)}
            </option>
          ))}
        </select>
        {org && <input type="hidden" name="org" value={org} />}
        <button className={buttonClass}>{t('web:admin.filter')}</button>
        {org && (
          <span className="text-sm text-neutral-500">{t('web:admin.tx.forOrg', { name: names.get(org) ?? org })}</span>
        )}
      </form>
      {page.items.length === 0 ? (
        <Empty>{ref ? t('web:admin.tx.notFound') : t('web:admin.payouts.none')}</Empty>
      ) : (
        <TransactionsTable items={page.items} orgNames={names} />
      )}
      <NextPage
        next={page.next}
        base="/admin/transactions"
        params={{ status: status ?? '', purpose: purpose ?? '', org }}
        label={t('web:admin.nextPage')}
      />
    </div>
  )
}
