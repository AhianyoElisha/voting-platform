import CreateEventForm from '@/components/events/CreateEventForm'
import { getTranslations } from '@/lib/i18n-server'
import { resolveWorkspace } from '@/lib/page-tenant'
import { canManage } from '@/lib/tenant'
import { Heading } from '@/shared/Heading'
import { notFound } from 'next/navigation'

type Props = { params: Promise<{ orgSlug: string }> }

export default async function NewEventPage({ params }: Props) {
  const { orgSlug } = await params
  const { ctx, organization } = await resolveWorkspace(orgSlug, `/dashboard/${orgSlug}/events/new`)
  if (!canManage(ctx.role)) notFound()
  const { t } = await getTranslations()

  return (
    <main className="container py-16 lg:py-24">
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{organization.name}</p>
          <Heading>{t('web:events.new.title')}</Heading>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{t('web:events.new.helper')}</p>
        </div>
        <CreateEventForm orgId={organization.$id} orgSlug={orgSlug} />
      </div>
    </main>
  )
}
