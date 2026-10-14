import { getTranslations } from '@/lib/i18n-server'
import { Heading } from '@/shared/Heading'
import { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations()
  return { title: t('web:seo.dashboard.title') }
}

export default async function Page() {
  const { t } = await getTranslations()

  return (
    <main className="container py-16 lg:py-24">
      <Heading>{t('web:placeholder.dashboard.title')}</Heading>
      <p className="mt-4 text-neutral-500 dark:text-neutral-400">{t('web:placeholder.dashboard.body')}</p>
    </main>
  )
}
