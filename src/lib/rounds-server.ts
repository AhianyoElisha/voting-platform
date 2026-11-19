import { Query } from 'node-appwrite'
import { writeAuditLog } from './audit'
import { APPWRITE } from './constants'
import {
  TenantMismatchError,
  createTenantDocument,
  deleteTenantDocument,
  getTenantDocument,
  listTenantDocuments,
  updateTenantDocument,
  type TenantContext,
} from './db'
import { cedisToPesewas, isPesewas } from './money'
import { assertCanManage } from './tenant'
import { type EventDoc, type NomineeDoc, type RoundDoc, type RoundEntryDoc, type RoundStatus } from './types'

/**
 * Rounds (PRD 5.2b, CLAUDE.md rule 3b). `pending → live → closed`, at most
 * one live round per event, and `closed` is terminal: nothing in a closed
 * round changes again.
 *
 * Decision #30 (2026-11-12): the organizer picks by hand which nominees are
 * in each round after the first (`setRoundEntrants`), a nominee added after
 * round 1 has closed joins the next round that is not closed
 * (`nextOpenRound`, used by `createNominee`), and a round may set its own
 * price per vote, the event's price being the default (`effectiveVotePrice`).
 * Entrants and price can only change while the round is `pending`: once it
 * is live, payments are being taken against both.
 */
export type RoundProblem =
  | 'badTransition'
  | 'anotherRoundLive'
  | 'eventClosed'
  | 'nameTooLong'
  | 'roundClosed'
  | 'notPending'
  | 'nomineeNotInEvent'
  | 'priceInvalid'
  | 'priceZero'

export class RoundError extends Error {
  constructor(public readonly problem: RoundProblem) {
    super(`Round: ${problem}`)
    this.name = 'RoundError'
  }
}

const ROUND_TRANSITIONS: Record<RoundStatus, readonly RoundStatus[]> = {
  pending: ['live'],
  live: ['closed'],
  closed: [],
}

export function canTransitionRound(from: RoundStatus, to: RoundStatus): boolean {
  return ROUND_TRANSITIONS[from].includes(to)
}

/** For the vote pipeline and anything else that writes into a round. */
export function assertRoundAcceptsWrites(round: Pick<RoundDoc, 'status'>): void {
  if (round.status === 'closed') throw new RoundError('roundClosed')
}

export async function listRounds(ctx: TenantContext, eventId: string): Promise<RoundDoc[]> {
  const res = await listTenantDocuments<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, [
    Query.equal('eventId', [eventId]),
    Query.orderAsc('number'),
    Query.limit(100),
  ])
  return res.documents
}

export async function getRound(ctx: TenantContext, roundId: string): Promise<RoundDoc> {
  return getTenantDocument<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, roundId)
}

export async function findLiveRound(ctx: TenantContext, eventId: string): Promise<RoundDoc | null> {
  const res = await listTenantDocuments<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, [
    Query.equal('eventId', [eventId]),
    Query.equal('status', ['live']),
    Query.limit(1),
  ])
  return res.documents[0] ?? null
}

/** The price a vote costs in `round`: its own when set, else the event's. Pesewas. */
export function effectiveVotePrice(
  event: Pick<EventDoc, 'votePrice'>,
  round?: Pick<RoundDoc, 'votePrice'> | null
): number {
  const own = round?.votePrice
  return typeof own === 'number' && isPesewas(own) && own > 0 ? own : event.votePrice
}

/** The lowest-numbered round that is not closed: where a nominee added now belongs. */
export async function nextOpenRound(ctx: TenantContext, eventId: string): Promise<RoundDoc | null> {
  return (await listRounds(ctx, eventId)).find((r) => r.status !== 'closed') ?? null
}

async function pendingRound(ctx: TenantContext, eventId: string, roundId: string): Promise<RoundDoc> {
  assertCanManage(ctx)
  const round = await getRound(ctx, roundId)
  if (round.eventId !== eventId) throw new TenantMismatchError(APPWRITE.TABLES.ROUNDS, roundId)
  if (round.status === 'closed') throw new RoundError('roundClosed')
  if (round.status !== 'pending') throw new RoundError('notPending')
  return round
}

/**
 * Sets a pending round's own price per vote, or clears it (empty input) so
 * the event's price applies. `votePriceCedis` is what the organizer typed.
 */
export async function setRoundPrice(
  ctx: TenantContext,
  eventId: string,
  roundId: string,
  votePriceCedis: string | null
): Promise<RoundDoc> {
  const round = await pendingRound(ctx, eventId, roundId)
  let votePrice: number | null = null
  if (votePriceCedis !== null && votePriceCedis.trim() !== '') {
    try {
      votePrice = cedisToPesewas(votePriceCedis)
    } catch {
      throw new RoundError('priceInvalid')
    }
    if (votePrice <= 0) throw new RoundError('priceZero')
  }
  if ((round.votePrice ?? null) === votePrice) return round
  const updated = await updateTenantDocument<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, roundId, { votePrice })
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'round.price',
    target: `rounds/${roundId}`,
    metadata: { eventId, number: round.number, before: round.votePrice ?? null, after: votePrice },
  })
  return updated
}

/**
 * The organizer's pick of who is in a pending round (decision #30): exactly
 * `nomineeIds` afterwards. Every id must be an active nominee of this event.
 * Entries are only ever removed from a round that has not started, so no
 * vote can be attached to one that goes; a closed round is never touched.
 */
export async function setRoundEntrants(
  ctx: TenantContext,
  eventId: string,
  roundId: string,
  nomineeIds: string[]
): Promise<{ added: number; removed: number; total: number }> {
  const round = await pendingRound(ctx, eventId, roundId)
  const wanted = new Set(nomineeIds)
  const [nominees, entries] = await Promise.all([
    listTenantDocuments<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, [
      Query.equal('eventId', [eventId]),
      Query.limit(500),
    ]),
    listTenantDocuments<RoundEntryDoc>(ctx, APPWRITE.TABLES.ROUND_ENTRIES, [
      Query.equal('roundId', [roundId]),
      Query.limit(500),
    ]),
  ])
  const eligible = new Set(nominees.documents.filter((n) => n.status === 'active').map((n) => n.$id))
  for (const id of wanted) if (!eligible.has(id)) throw new RoundError('nomineeNotInEvent')

  const existing = new Map(entries.documents.map((e) => [e.nomineeId, e]))
  let added = 0
  let removed = 0
  for (const id of wanted) {
    if (existing.has(id)) continue
    await createTenantDocument<RoundEntryDoc>(ctx, APPWRITE.TABLES.ROUND_ENTRIES, {
      eventId,
      roundId,
      nomineeId: id,
      voteCount: 0,
    })
    added += 1
  }
  for (const [id, entry] of existing) {
    // A pending round has taken no votes; the count check is belt and braces.
    if (wanted.has(id) || entry.voteCount !== 0) continue
    // Stop removing the moment the round is opened by someone else: from then on
    // payments are being taken against its entries.
    if ((await getRound(ctx, roundId)).status !== 'pending') throw new RoundError('notPending')
    await deleteTenantDocument<RoundEntryDoc>(ctx, APPWRITE.TABLES.ROUND_ENTRIES, entry.$id)
    removed += 1
  }
  if (added || removed) {
    await writeAuditLog({
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      action: 'round.entrants',
      target: `rounds/${roundId}`,
      metadata: { eventId, number: round.number, added, removed, total: wanted.size },
    })
  }
  return { added, removed, total: wanted.size }
}

export async function createRound(ctx: TenantContext, eventId: string, name?: string): Promise<RoundDoc> {
  assertCanManage(ctx)
  const event = await getTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, eventId)
  if (event.status === 'closed') throw new RoundError('eventClosed')

  const rounds = await listRounds(ctx, eventId)
  const number = rounds.reduce((max, r) => Math.max(max, r.number), 0) + 1
  const roundName = (name ?? '').trim() || `Round ${number}`
  if (roundName.length > 80) throw new RoundError('nameTooLong')

  return createTenantDocument<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, {
    eventId,
    number,
    name: roundName,
    startsAt: null,
    endsAt: null,
    status: 'pending',
    closedAt: null,
  })
}

export async function openRound(ctx: TenantContext, roundId: string): Promise<RoundDoc> {
  assertCanManage(ctx)
  const round = await getRound(ctx, roundId)
  if (!canTransitionRound(round.status, 'live')) throw new RoundError('badTransition')
  const event = await getTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, round.eventId)
  if (event.status === 'closed') throw new RoundError('eventClosed')
  const live = await findLiveRound(ctx, round.eventId)
  if (live && live.$id !== roundId) throw new RoundError('anotherRoundLive')

  const updated = await updateTenantDocument<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, roundId, {
    status: 'live',
    startsAt: new Date().toISOString(),
  })
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'round.open',
    target: `rounds/${roundId}`,
    metadata: { eventId: round.eventId, number: round.number },
  })
  return updated
}

/** Freezes the round (rule 3b). Its entries and votes are immutable from here on. */
export async function closeRound(ctx: TenantContext, roundId: string): Promise<RoundDoc> {
  assertCanManage(ctx)
  const round = await getRound(ctx, roundId)
  if (!canTransitionRound(round.status, 'closed')) throw new RoundError('badTransition')

  const now = new Date().toISOString()
  const updated = await updateTenantDocument<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, roundId, {
    status: 'closed',
    endsAt: now,
    closedAt: now,
  })
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'round.close',
    target: `rounds/${roundId}`,
    metadata: { eventId: round.eventId, number: round.number },
  })
  return updated
}
