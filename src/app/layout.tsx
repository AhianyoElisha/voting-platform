import '@/styles/tailwind.css'
import { AuthProvider } from '@/context/auth'
import { getResources } from '@/lib/i18n-catalog'
import { getTranslations, resolveLocale } from '@/lib/i18n-server'
import { Metadata } from 'next'
import { Poppins } from 'next/font/google'
import I18nProvider from './i18n-provider'
import ThemeProvider from './theme-provider'

const poppins = Poppins({
  subsets: ['latin'],
  display: 'swap',
  weight: ['300', '400', '500', '600', '700'],
})

// `export const metadata` is evaluated at module scope and cannot read the
// request, so it cannot see the negotiated locale. `generateMetadata()` can.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations()
  return {
    title: {
      template: t('web:seo.titleTemplate'),
      default: t('web:seo.default.title'),
    },
    description: t('web:seo.default.description'),
    keywords: t('web:seo.default.keywords')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Cookie -> Accept-Language -> 'en'. No `[locale]` URL segment.
  const locale = await resolveLocale()

  return (
    <html lang={locale} className={poppins.className}>
      <body className="bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
        <ThemeProvider>
          <div>
            <I18nProvider locale={locale} resources={getResources(locale)}>
              <AuthProvider>{children}</AuthProvider>
            </I18nProvider>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
