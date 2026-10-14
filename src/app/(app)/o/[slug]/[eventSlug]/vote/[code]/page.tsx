import VoteForm from '@/components/vote/VoteForm'
import { APPWRITE } from '@/lib/constants'
import { getOrganizationBySlug, listTenantDocuments, type TenantContext } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import { findNomineeByCode } from '@/lib/nominee-code'
import { isMockProviderActive } from '@/lib/payments'
import type { CategoryDoc, EventDoc } from '@/lib/types'
import { Heading } from '@/shared/Heading'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Query } from 'node-appwrite'

type Props = { params: Promise<{ slug: string; eventSlug: string; code: string }> }

export default async function VotePage({ params }: Props) {
  const { slug, eventSlug, code } = await params
  const organization = await getOrganizationBySlug(slug)
  if (!organization || organization.status !== 'active') notFound()

  const ctx: TenantContext = { organizationId: organization.$id, userId: 'public', role: 'scanner' }
  const events = await listTenantDocuments<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, [
    Query.equal('slug', [eventSlug]),
    Query.limit(1),
  ])
  const event = events.documents[0]
  if (!event || !['scheduled', 'live', 'paused'].includes(event.status)) notFound()

  const nominee = await findNomineeByCode(code)
  if (
    !nominee ||
    nominee.eventId !== event.$id ||
    nominee.organizationId !== organization.$id ||
    nominee.status !== 'active'
  )
    notFound()

  const categories = await listTenantDocuments<CategoryDoc>(ctx, APPWRITE.TABLES.CATEGORIES, [
    Query.equal('$id', [nominee.categoryId]),
    Query.limit(1),
  ])
  const { t } = await getTranslations()
  const live = event.status === 'live'

  return (
    <main className="container py-16 lg:py-24">
      <div className="mx-auto max-w-md space-y-6">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          <Link href={`/o/${slug}/${eventSlug}`} className="underline">
            {event.title}
          </Link>
          {categories.documents[0] ? ` / ${categories.documents[0].name}` : ''}
        </p>
        <div>
          <Heading>{nominee.name}</Heading>
          {nominee.isMorale && (
            <p className="mt-1 inline-block rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {t('web:publicEvent.morale')} · {t('web:publicEvent.moraleHelper')}
            </p>
          )}
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {t('web:publicEvent.code')}{' '}
            <span className="font-mono text-neutral-900 dark:text-white">{nominee.code}</span> ·{' '}
            {t('web:publicEvent.pricePerVote', { price: formatPesewas(event.votePrice) })}
          </p>
          {nominee.bio && <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">{nominee.bio}</p>}
        </div>
        {live ? (
          <VoteForm
            code={nominee.code}
            nomineeName={nominee.name}
            votePrice={event.votePrice}
            mockProvider={process.env.NODE_ENV !== 'production' && isMockProviderActive()}
          />
        ) : (
          <p className="rounded-xl bg-neutral-100 p-4 text-center text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {t('web:vote.notLive')}
          </p>
        )}
      </div>
    </main>
  )
}
