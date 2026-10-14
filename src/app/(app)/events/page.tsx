import { getTranslations } from '@/lib/i18n-server'
import { Heading } from '@/shared/Heading'

export default async function EventsPage() {
  const { t } = await getTranslations()

  return (
    <main className="container py-16 lg:py-24">
      <Heading>{t('web:placeholder.events.title')}</Heading>
      <p className="mt-4 text-neutral-500 dark:text-neutral-400">{t('web:placeholder.events.body')}</p>
    </main>
  )
}
