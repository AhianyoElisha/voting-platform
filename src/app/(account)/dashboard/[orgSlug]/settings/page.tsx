import OrganizationSettingsForm from '@/components/organization/OrganizationSettingsForm'
import { parseBrandColors } from '@/lib/branding'
import { getTranslations } from '@/lib/i18n-server'
import { resolveWorkspace } from '@/lib/page-tenant'
import { canManage } from '@/lib/tenant'
import { Heading } from '@/shared/Heading'
import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations()
  return { title: t('web:orgSettings.title') }
}

type Props = { params: Promise<{ orgSlug: string }> }

/** Organization settings (PRD 5.1): name, logo and brand colours. Owners and admins. */
export default async function OrganizationSettingsPage({ params }: Props) {
  const { orgSlug } = await params
  const { ctx, organization } = await resolveWorkspace(orgSlug, `/dashboard/${orgSlug}/settings`)
  if (!canManage(ctx.role)) notFound()
  const { t } = await getTranslations()
  return (
    <main className="container space-y-8 py-16 lg:py-24">
      <div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          <Link href="/dashboard" className="underline">
            {t('web:dashboard.title')}
          </Link>{' '}
          / {organization.name}
        </p>
        <Heading>{t('web:orgSettings.title')}</Heading>
      </div>
      <OrganizationSettingsForm
        orgId={organization.$id}
        slug={organization.slug}
        initial={{
          name: organization.name,
          logoUrl: organization.logoUrl,
          colors: parseBrandColors(organization.brandColors),
        }}
      />
    </main>
  )
}
