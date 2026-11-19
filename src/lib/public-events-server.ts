import { Query } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { APPWRITE } from './constants'
import { databaseId, type Doc } from './db'
import { PUBLIC_EVENT_STATUSES } from './public-events'
import { effectiveVotePrice } from './rounds-server'
import type { EventDoc, OrganizationDoc, RoundDoc } from './types'

/** How many events the platform directory reads at most. */
export const DIRECTORY_LIMIT = 200

export interface DirectoryEntry {
  event: Doc<EventDoc>
  organization: Doc<OrganizationDoc>
}

/**
 * The platform's public event directory (`/events`): every event the public
 * may see, with its organization.
 *
 * Deliberately cross-tenant, and safe to be: it returns only what each
 * organization already publishes at `/o/{slug}`. Public statuses only
 * (`public-events.ts`), and only events of `active` organizations, so a
 * suspended organization disappears here as it does on its own pages.
 */
export async function listDirectoryEvents(): Promise<DirectoryEntry[]> {
  const { databases } = createAdminClient()
  const events = await withRetry(() =>
    databases.listDocuments<Doc<EventDoc>>(databaseId(), APPWRITE.TABLES.EVENTS, [
      Query.equal('status', [...PUBLIC_EVENT_STATUSES]),
      Query.limit(DIRECTORY_LIMIT),
    ])
  )
  if (events.documents.length === 0) return []

  const organizationIds = [...new Set(events.documents.map((e) => e.organizationId))]
  const organizations = new Map<string, Doc<OrganizationDoc>>()
  for (let i = 0; i < organizationIds.length; i += 100) {
    const res = await withRetry(() =>
      databases.listDocuments<Doc<OrganizationDoc>>(databaseId(), APPWRITE.TABLES.ORGANIZATIONS, [
        Query.equal('$id', organizationIds.slice(i, i + 100)),
        Query.equal('status', ['active']),
        Query.limit(100),
      ])
    )
    for (const o of res.documents) organizations.set(o.$id, o)
  }

  return events.documents.flatMap((event) => {
    const organization = organizations.get(event.organizationId)
    return organization ? [{ event, organization }] : []
  })
}

/**
 * What a vote costs right now in each of `events`: the live round's own price
 * when it sets one, else the event's (decision #30). For public lists, where
 * showing the event's base price beside a round that charges another would
 * mislead. Events must already be ones the caller may show.
 */
export async function currentVotePrices(
  events: Pick<Doc<EventDoc>, '$id' | 'organizationId' | 'votePrice'>[]
): Promise<Map<string, number>> {
  const prices = new Map(events.map((e) => [e.$id, e.votePrice]))
  if (events.length === 0) return prices
  const { databases } = createAdminClient()
  const byId = new Map(events.map((e) => [e.$id, e]))
  const ids = [...byId.keys()]
  for (let i = 0; i < ids.length; i += 100) {
    const res = await withRetry(() =>
      databases.listDocuments<Doc<RoundDoc>>(databaseId(), APPWRITE.TABLES.ROUNDS, [
        Query.equal('eventId', ids.slice(i, i + 100)),
        Query.equal('status', ['live']),
        Query.limit(100),
      ])
    )
    for (const round of res.documents) {
      const event = byId.get(round.eventId)
      if (event && round.organizationId === event.organizationId) {
        prices.set(event.$id, effectiveVotePrice(event, round))
      }
    }
  }
  return prices
}
