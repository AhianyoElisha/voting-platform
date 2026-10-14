import FontUploadForm from '@/components/flyer/FontUploadForm'
import TemplateEditor from '@/components/flyer/TemplateEditor'
import { APPWRITE } from '@/lib/constants'
import { TenantMismatchError } from '@/lib/db'
import { parseModel } from '@/lib/flyer/model'
import { TemplateError, fileViewUrl, getTemplate, listFonts } from '@/lib/flyer/templates-server'
import { getTranslations } from '@/lib/i18n-server'
import { resolveWorkspace } from '@/lib/page-tenant'
import { canDesign } from '@/lib/tenant'
import { Heading } from '@/shared/Heading'
import Link from 'next/link'
import { notFound } from 'next/navigation'

type Props = { params: Promise<{ orgSlug: string; eventId: string; templateId: string }> }

export default async function TemplateEditorPage({ params }: Props) {
  const { orgSlug, eventId, templateId } = await params
  const { ctx, organization } = await resolveWorkspace(
    orgSlug,
    `/dashboard/${orgSlug}/events/${eventId}/flyer/${templateId}`
  )
  if (!canDesign(ctx.role)) notFound()
  const { t } = await getTranslations()
  let template
  try {
    template = await getTemplate(ctx, templateId, eventId)
  } catch (err) {
    if (err instanceof TenantMismatchError || err instanceof TemplateError || (err as { code?: number })?.code === 404)
      notFound()
    throw err
  }
  const fonts = await listFonts(ctx.organizationId)

  return (
    <main className="container space-y-8 py-16 lg:py-24">
      <div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          <Link href={`/dashboard/${orgSlug}/events/${eventId}`} className="underline">
            {organization.name}
          </Link>{' '}
          / {t('web:flyer.editor.title')}
        </p>
        <Heading>{template.name}</Heading>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">{t('web:flyer.editor.intro')}</p>
      </div>

      <TemplateEditor
        orgId={organization.$id}
        eventId={eventId}
        template={{
          id: template.$id,
          name: template.name,
          width: template.width,
          height: template.height,
          backgroundUrl: template.backgroundFileId
            ? fileViewUrl(APPWRITE.BUCKETS.FLYER_TEMPLATES, template.backgroundFileId)
            : null,
          model: parseModel(template.canvasJson, template.width, template.height),
          status: template.status,
          version: template.version,
        }}
        fonts={fonts.map((f) => ({
          id: f.$id,
          family: f.family,
          weight: f.weight,
          style: f.style,
          url: fileViewUrl(APPWRITE.BUCKETS.FONTS, f.fileId),
          platform: f.organizationId === null,
        }))}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">{t('web:flyer.fonts.title')}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:flyer.fonts.helper')}</p>
        {fonts.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-xs">
            {fonts.map((f) => (
              <li key={f.$id} className="rounded-lg border border-neutral-200 px-2 py-1 dark:border-neutral-700">
                {f.family} {f.weight} {f.style === 'italic' ? 'italic' : ''}
              </li>
            ))}
          </ul>
        )}
        <FontUploadForm orgId={organization.$id} />
      </section>
    </main>
  )
}
