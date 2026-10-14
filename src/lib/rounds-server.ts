import { Query } from 'node-appwrite'
import { writeAuditLog } from './audit'
import { APPWRITE } from './constants'
import {
  createTenantDocument,
  getTenantDocument,
  listTenantDocuments,
  updateTenantDocument,
  type TenantContext,
} from './db'
import { assertCanManage } from './tenant'
import { type EventDoc, type RoundDoc, type RoundStatus } from './types'

/**
 * Rounds (PRD 5.2b, CLAUDE.md rule 3b). `pending → live → closed`, at most
 * one live round per event, and `closed` is terminal: nothing in a closed
 * round changes again.
 *
 * Who advances into round 2+ and whether the price changes per round are
 * OPEN_QUESTIONS #30. Rounds after the first can be created and opened, but
 * get no entries until that is settled.
 */
export type RoundProblem = 'badTransition' | 'anotherRoundLive' | 'eventClosed' | 'nameTooLong' | 'roundClosed'

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
