import { adminMetadata, requireAdminPage } from '@/lib/admin-page'
import { platformOverview } from '@/lib/admin-server'
import { freeVotesEnabledOnPlatform, moraleCandidatesEnabledOnPlatform } from '@/lib/constants'
import { platformCommissionBps } from '@/lib/fees'
import { getTranslations } from '@/lib/i18n-server'
import { Metadata } from 'next'
import Link from 'next/link'

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata('web:seo.admin.title')
}

/** Super admin console (PRD 5.7): what needs attention, and the platform-wide settings. */
export default async function AdminOverviewPage() {
  await requireAdminPage('/admin')
  const { t } = await getTranslations()
  const o = await platformOverview()
  let rate: string
  try {
    rate = `${platformCommissionBps() / 100}%`
  } catch {
    rate = t('web:admin.overview.rateInvalid')
  }
  const cards = [
    { label: t('web:admin.overview.organizations'), value: o.organizations, href: '/admin/organizations' },
    { label: t('web:admin.overview.suspended'), value: o.suspended, href: '/admin/organizations?status=suspended' },
    { label: t('web:admin.overview.pendingPayouts'), value: o.pendingPayouts, href: '/admin/payouts' },
    {
      label: t('web:admin.overview.pendingPayments'),
      value: o.pendingPayments,
      href: '/admin/transactions?status=pending',
    },
  ]
  const onOff = (on: boolean) => (on ? t('web:admin.on') : t('web:admin.off'))
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="stat surface-hover">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{c.label}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-neutral-900 dark:text-white">{c.value}</p>
          </Link>
        ))}
      </div>
      <section className="space-y-2 surface p-4 text-sm">
        <h2 className="font-semibold text-neutral-900 dark:text-white">{t('web:admin.overview.platform')}</h2>
        <p>
          {t('web:admin.overview.commission')}: <strong>{rate}</strong>
        </p>
        <p>
          {t('web:admin.settings.morale')}: <strong>{onOff(moraleCandidatesEnabledOnPlatform())}</strong>
          {' · '}
          {t('web:admin.settings.freeVotes')}: <strong>{onOff(freeVotesEnabledOnPlatform())}</strong>
        </p>
        <p className="text-neutral-500 dark:text-neutral-400">{t('web:admin.overview.platformHelper')}</p>
      </section>
    </div>
  )
}
