import AdminNav from '@/components/admin/AdminNav'
import { getTranslations } from '@/lib/i18n-server'
import { Heading } from '@/shared/Heading'

// Chrome only. Each page checks the super admin itself (`requireAdminPage`).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getTranslations()
  return (
    <main className="container space-y-8 py-12 lg:py-16">
      <Heading>{t('web:admin.title')}</Heading>
      <AdminNav />
      {children}
    </main>
  )
}
