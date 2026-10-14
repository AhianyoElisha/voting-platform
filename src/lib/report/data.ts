import { Query } from 'node-appwrite'
import { APPWRITE } from '../constants'
import { getOrganization, getTenantDocument, listTenantDocuments, type TenantContext } from '../db'
import type { CategoryDoc, EventDoc, NomineeDoc, OrganizationDoc, RoundDoc, RoundEntryDoc, VoteDoc } from '../types'
import { buildCumulativeReport, type CumulativeReport } from './model'

/** Loads everything the report needs through the scoped helpers and builds it. */
export async function loadCumulativeReport(
  ctx: TenantContext,
  eventId: string
): Promise<{ report: CumulativeReport; event: EventDoc; organization: OrganizationDoc | null }> {
  const event = await getTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, eventId)
  const byEvent = [Query.equal('eventId', [eventId])]
  const [rounds, categories, nominees, votes, entries, organization] = await Promise.all([
    listTenantDocuments<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, [...byEvent, Query.limit(100)]),
    listTenantDocuments<CategoryDoc>(ctx, APPWRITE.TABLES.CATEGORIES, [...byEvent, Query.limit(100)]),
    listTenantDocuments<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, [...byEvent, Query.limit(500)]),
    listTenantDocuments<VoteDoc>(ctx, APPWRITE.TABLES.VOTES, [...byEvent, Query.limit(5000)]),
    listTenantDocuments<RoundEntryDoc>(ctx, APPWRITE.TABLES.ROUND_ENTRIES, [...byEvent, Query.limit(5000)]),
    getOrganization(ctx.organizationId),
  ])
  const report = buildCumulativeReport({
    event,
    rounds: rounds.documents,
    categories: categories.documents,
    nominees: nominees.documents,
    votes: votes.documents,
    entries: new Set(entries.documents.map((e) => `${e.roundId}:${e.nomineeId}`)),
  })
  return { report, event, organization }
}
