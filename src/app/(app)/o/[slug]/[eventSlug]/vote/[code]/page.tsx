import BrandBand from '@/components/organization/BrandBand'
import PhotoAvatar from '@/components/PhotoAvatar'
import VoteForm from '@/components/vote/VoteForm'
import { parseBrandColors } from '@/lib/branding'
import { APPWRITE } from '@/lib/constants'
import { getOrganizationBySlug, listTenantDocuments, type TenantContext } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { formatPesewas } from '@/lib/money'
import { findNomineeByCode } from '@/lib/nominee-code'
import { isMockProviderActive } from '@/lib/payments'
import { focusOf } from '@/lib/photo-focus'
import { isPublicEvent } from '@/lib/public-events'
import { effectiveVotePrice, findLiveRound } from '@/lib/rounds-server'
import { maxVotesFor } from '@/lib/vote-limits'
import type { CategoryDoc, EventDoc } from '@/lib/types'
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
  if (!event || !isPublicEvent(event)) notFound()

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
  // The same price the payment will be charged at (`quoteVote`): the live round's own, else the event's.
  const votePrice = effectiveVotePrice(event, await findLiveRound(ctx, event.$id))

  return (
    <main className="container py-16 lg:py-24">
      <div className="mx-auto max-w-md space-y-6">
        <BrandBand
          href={`/o/${organization.slug}`}
          name={organization.name}
          logoUrl={organization.logoUrl}
          colors={parseBrandColors(organization.brandColors)}
        />
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          <Link href={`/o/${slug}/${eventSlug}`} className="underline">
            {event.title}
          </Link>
          {categories.documents[0] ? ` / ${categories.documents[0].name}` : ''}
        </p>
        <div className="overflow-hidden surface">
          <PhotoAvatar
            name={nominee.name}
            photoUrl={nominee.photoUrl}
            focus={focusOf(nominee)}
            className="aspect-[4/3] w-full text-6xl"
          />
          <div className="p-5">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-950 dark:text-white">{nominee.name}</h1>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-primary-50 px-3 py-1 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                {t('web:publicEvent.code')} <span className="font-mono">{nominee.code}</span>
              </span>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                {t('web:publicEvent.pricePerVote', { price: formatPesewas(votePrice) })}
              </span>
            </div>
            {nominee.bio && <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">{nominee.bio}</p>}
          </div>
        </div>
        {live ? (
          <VoteForm
            code={nominee.code}
            nomineeName={nominee.name}
            votePrice={votePrice}
            maxQuantity={maxVotesFor(votePrice)}
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
