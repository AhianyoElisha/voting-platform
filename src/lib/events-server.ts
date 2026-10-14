import { Query } from 'node-appwrite'
import { writeAuditLog } from './audit'
import { APPWRITE } from './constants'
import {
  createTenantDocument,
  deleteTenantDocument,
  getTenantDocument,
  listTenantDocuments,
  updateTenantDocument,
  type TenantContext,
} from './db'
import { InvalidAmountError, cedisToPesewas, isPesewas } from './money'
import { closeRound, findLiveRound, openRound } from './rounds-server'
import { slugify, validateSlug } from './slug'
import { assertCanManage } from './tenant'
import {
  EVENT_STATUSES,
  RESULTS_VISIBILITIES,
  type EventDoc,
  type EventStatus,
  type ResultsVisibility,
  type RoundDoc,
} from './types'

/**
 * Events (PRD 5.2). Every event has at least one round (rule 3b): round 1 is
 * created with the event, so an event "without rounds" is a one-round event.
 */
export type EventProblem =
  | 'titleTooShort'
  | 'titleTooLong'
  | 'slugInvalid'
  | 'slugTaken'
  | 'priceInvalid'
  | 'priceZero'
  | 'datesInvalid'
  | 'visibilityInvalid'
  | 'badTransition'
  | 'eventClosed'
  | 'noRoundToOpen'

export class EventError extends Error {
  constructor(public readonly problem: EventProblem) {
    super(`Event: ${problem}`)
    this.name = 'EventError'
  }
}

export interface CreateEventInput {
  title: string
  slug?: string
  description?: string
  /** Cedis as typed in the form, e.g. "1.50"; converted once here. */
  votePriceCedis?: string
  /** Already-integer pesewas, for API callers. Takes precedence. */
  votePrice?: number
  startsAt: string
  endsAt: string
  /** No default on purpose: OPEN_QUESTIONS #26. The organizer must choose. */
  resultsVisibility: string
  moraleCandidatesEnabled?: boolean
}

export function normalizeEventInput(input: CreateEventInput) {
  const title = (input.title ?? '').trim().replace(/\s+/g, ' ')
  if (title.length < 2) throw new EventError('titleTooShort')
  if (title.length > 120) throw new EventError('titleTooLong')

  const slug = (input.slug ?? '').trim() ? (input.slug as string).trim().toLowerCase() : slugify(title)
  if (validateSlug(slug)) throw new EventError('slugInvalid')

  let votePrice: number
  if (input.votePrice !== undefined) {
    if (!isPesewas(input.votePrice)) throw new EventError('priceInvalid')
    votePrice = input.votePrice
  } else {
    try {
      votePrice = cedisToPesewas(input.votePriceCedis ?? '')
    } catch (err) {
      if (err instanceof InvalidAmountError) throw new EventError('priceInvalid')
      throw err
    }
  }
  if (votePrice <= 0) throw new EventError('priceZero')

  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(input.endsAt)
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new EventError('datesInvalid')
  }

  if (!RESULTS_VISIBILITIES.includes(input.resultsVisibility as ResultsVisibility))
    throw new EventError('visibilityInvalid')

  return {
    title,
    slug,
    description: (input.description ?? '').trim() || null,
    votePrice,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    resultsVisibility: input.resultsVisibility as ResultsVisibility,
    moraleCandidatesEnabled: input.moraleCandidatesEnabled === true,
  }
}

function isConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: number }).code === 409
}

export async function createEvent(
  ctx: TenantContext,
  input: CreateEventInput
): Promise<{ event: EventDoc; round: RoundDoc }> {
  assertCanManage(ctx)
  const data = normalizeEventInput(input)

  const existing = await listTenantDocuments<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, [
    Query.equal('slug', [data.slug]),
    Query.limit(1),
  ])
  if (existing.documents.length > 0) throw new EventError('slugTaken')

  let event: EventDoc
  try {
    event = await createTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, {
      ...data,
      coverImageUrl: null,
      eventCode: null,
      status: 'draft',
      resultsPublishedAt: null,
    })
  } catch (err) {
    if (isConflict(err)) throw new EventError('slugTaken')
    throw err
  }

  // Round 1 is part of the event (rule 3b). No event without it.
  try {
    const round = await createTenantDocument<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, {
      eventId: event.$id,
      number: 1,
      name: 'Round 1',
      startsAt: null,
      endsAt: null,
      status: 'pending',
      closedAt: null,
    })
    return { event, round }
  } catch (err) {
    await deleteTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, event.$id).catch(() => {})
    throw err
  }
}

export async function listEvents(ctx: TenantContext): Promise<EventDoc[]> {
  const res = await listTenantDocuments<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, [
    Query.orderDesc('$createdAt'),
    Query.limit(100),
  ])
  return res.documents
}

export async function getEvent(ctx: TenantContext, eventId: string): Promise<EventDoc> {
  return getTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, eventId)
}

export async function getEventBySlug(ctx: TenantContext, slug: string): Promise<EventDoc | null> {
  const res = await listTenantDocuments<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, [
    Query.equal('slug', [slug]),
    Query.limit(1),
  ])
  return res.documents[0] ?? null
}

// ─── Status machine ────────────────────────────────────────────

const EVENT_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  draft: ['scheduled', 'live'],
  scheduled: ['draft', 'live'],
  live: ['paused', 'closed'],
  paused: ['live', 'closed'],
  closed: [],
}

export function canTransitionEvent(from: EventStatus, to: EventStatus): boolean {
  return EVENT_STATUSES.includes(to) && EVENT_TRANSITIONS[from].includes(to)
}

export function isEventOpenForChanges(event: Pick<EventDoc, 'status'>): boolean {
  return event.status !== 'closed'
}

/**
 * Moves an event between statuses and keeps the rounds consistent:
 * going live opens the lowest pending round if none is live; closing the
 * event closes the live round. Closed is terminal.
 */
export async function setEventStatus(ctx: TenantContext, eventId: string, to: EventStatus): Promise<EventDoc> {
  assertCanManage(ctx)
  const event = await getEvent(ctx, eventId)
  if (!canTransitionEvent(event.status, to)) throw new EventError('badTransition')

  if (to === 'live') {
    const live = await findLiveRound(ctx, eventId)
    if (!live) {
      const pending = await listTenantDocuments<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, [
        Query.equal('eventId', [eventId]),
        Query.equal('status', ['pending']),
        Query.orderAsc('number'),
        Query.limit(1),
      ])
      // Rule 3b: every vote belongs to a round, so an event is never live
      // without one. All rounds closed and none pending means add a round first.
      if (!pending.documents[0]) throw new EventError('noRoundToOpen')
      await openRound(ctx, pending.documents[0].$id)
    }
  }

  if (to === 'closed') {
    const live = await findLiveRound(ctx, eventId)
    if (live) await closeRound(ctx, live.$id)
  }

  const updated = await updateTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, eventId, { status: to })
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: `event.${to}`,
    target: `events/${eventId}`,
    metadata: { from: event.status },
  })
  return updated
}
