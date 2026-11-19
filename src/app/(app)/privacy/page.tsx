import { getTranslations } from '@/lib/i18n-server'
import { Heading } from '@/shared/Heading'
import { Metadata } from 'next'

/** Bump when the policy text in `web:privacy` changes; shown at the top of the page. */
const POLICY_UPDATED = '2026-11-19'

interface PolicySection {
  title: string
  paragraphs?: string[]
  items?: string[]
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations()
  return { title: t('web:privacy.title'), description: t('web:privacy.description') }
}

/**
 * The privacy policy (decision #28, 2026-11-13): linked from the consent
 * notice under the phone field on the vote and ticket forms, and from the
 * footer. USSD voters are covered by the same page. The text lives in
 * `web:privacy`; the contact address comes from `PRIVACY_CONTACT_EMAIL`.
 */
export default async function PrivacyPage() {
  const { t } = await getTranslations()
  const sections = t('web:privacy.sections', { returnObjects: true }) as unknown as PolicySection[]
  const contact = process.env.PRIVACY_CONTACT_EMAIL?.trim()
  const updated = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${POLICY_UPDATED}T00:00:00Z`)
  )

  return (
    <main className="container max-w-3xl py-16 lg:py-24">
      <Heading>{t('web:privacy.title')}</Heading>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        {t('web:privacy.updated', { date: updated })}
      </p>
      <p className="mt-6 text-neutral-700 dark:text-neutral-300">{t('web:privacy.intro')}</p>
      {contact && (
        <p className="mt-4 text-neutral-700 dark:text-neutral-300">
          {t('web:privacy.contactLabel')}{' '}
          <a href={`mailto:${contact}`} className="font-medium text-primary-600 underline dark:text-primary-400">
            {contact}
          </a>
        </p>
      )}

      <div className="mt-10 space-y-8">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="section-title">{section.title}</h2>
            {section.items && (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-neutral-700 dark:text-neutral-300">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {section.paragraphs?.map((p) => (
              <p key={p} className="mt-3 text-neutral-700 dark:text-neutral-300">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  )
}
