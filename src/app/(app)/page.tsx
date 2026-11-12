import { getTranslations } from '@/lib/i18n-server'
import ButtonSecondary from '@/shared/ButtonSecondary'
import {
  BanknotesIcon,
  ChartBarIcon,
  DevicePhoneMobileIcon,
  PhotoIcon,
  QrCodeIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import Link from 'next/link'

const FEATURES = [
  { key: 'flyers', icon: PhotoIcon },
  { key: 'ussd', icon: DevicePhoneMobileIcon },
  { key: 'results', icon: ChartBarIcon },
  { key: 'tickets', icon: QrCodeIcon },
  { key: 'payouts', icon: BanknotesIcon },
  { key: 'rounds', icon: SparklesIcon },
] as const

const STEPS = ['create', 'nominees', 'vote'] as const

export default async function HomePage() {
  const { t } = await getTranslations()

  return (
    <main className="relative container mb-24 space-y-24 lg:mb-32 lg:space-y-32">
      <section className="flex flex-col items-center pt-16 text-center lg:pt-28">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-xs font-semibold text-primary-700 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300">
          <SparklesIcon className="size-4" aria-hidden />
          {t('web:home.hero.eyebrow')}
        </span>
        <h1 className="mt-6 max-w-4xl text-4xl font-bold tracking-tight text-balance text-neutral-950 sm:text-5xl lg:text-6xl dark:text-white">
          {t('web:home.hero.titleStart')} <span className="text-brand">{t('web:home.hero.titleAccent')}</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base text-pretty text-neutral-600 sm:text-lg dark:text-neutral-300">
          {t('web:home.hero.subtitle')}
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link href="/signup" className="rounded-full btn-brand px-7 py-3.5 text-sm font-semibold sm:text-base">
            {t('web:home.hero.primaryCta')}
          </Link>
          <ButtonSecondary href="/events">{t('web:home.hero.secondaryCta')}</ButtonSecondary>
        </div>
        <p className="mt-6 text-xs text-neutral-500 dark:text-neutral-400">{t('web:home.hero.note')}</p>
      </section>

      <section>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl dark:text-white">
            {t('web:home.features.title')}
          </h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-300">{t('web:home.features.subtitle')}</p>
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key} className="surface-hover surface p-6">
              <span className="flex size-11 items-center justify-center rounded-xl bg-linear-to-br from-primary-600 to-secondary-500 text-white shadow-md shadow-primary-600/20">
                <Icon className="size-6" aria-hidden />
              </span>
              <h3 className="mt-4 font-semibold text-neutral-900 dark:text-white">
                {t(`web:home.features.${key}.title`)}
              </h3>
              <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">
                {t(`web:home.features.${key}.body`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-center text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl dark:text-white">
          {t('web:home.steps.title')}
        </h2>
        <ol className="mt-10 grid gap-6 lg:grid-cols-3">
          {STEPS.map((key, i) => (
            <li key={key} className="relative surface p-6 pt-8">
              <span className="absolute -top-4 left-6 flex size-9 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white shadow-lg dark:bg-white dark:text-neutral-900">
                {i + 1}
              </span>
              <h3 className="font-semibold text-neutral-900 dark:text-white">{t(`web:home.steps.${key}.title`)}</h3>
              <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">{t(`web:home.steps.${key}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="relative overflow-hidden rounded-3xl bg-linear-to-br from-primary-700 via-primary-600 to-secondary-600 px-6 py-14 text-center text-white shadow-xl shadow-primary-600/20 sm:px-12">
        <span aria-hidden className="absolute -top-16 -right-10 size-56 rounded-full bg-white/10" />
        <span aria-hidden className="absolute -bottom-20 -left-10 size-64 rounded-full bg-white/10" />
        <h2 className="relative text-2xl font-bold tracking-tight sm:text-3xl">{t('web:home.cta.title')}</h2>
        <p className="relative mx-auto mt-3 max-w-xl text-primary-100">{t('web:home.cta.body')}</p>
        <Link
          href="/signup"
          className="relative mt-8 inline-block rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-primary-700 shadow-lg transition hover:bg-primary-50 active:scale-[0.98]"
        >
          {t('web:home.hero.primaryCta')}
        </Link>
      </section>
    </main>
  )
}
