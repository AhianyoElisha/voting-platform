import { getTranslations } from '@/lib/i18n-server'
import ButtonPrimary from '@/shared/ButtonPrimary'
import ButtonSecondary from '@/shared/ButtonSecondary'
import { Heading } from '@/shared/Heading'

export default async function HomePage() {
  const { t } = await getTranslations()

  return (
    <main className="relative container mb-24 lg:mb-32">
      <div className="flex flex-col items-center py-16 text-center lg:py-28">
        <Heading className="max-w-3xl">{t('web:home.hero.title')}</Heading>
        <p className="mt-6 max-w-2xl text-base text-neutral-500 sm:text-lg dark:text-neutral-400">
          {t('web:home.hero.subtitle')}
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <ButtonPrimary href="/signup">{t('web:home.hero.primaryCta')}</ButtonPrimary>
          <ButtonSecondary href="/events">{t('web:home.hero.secondaryCta')}</ButtonSecondary>
        </div>
      </div>
    </main>
  )
}
