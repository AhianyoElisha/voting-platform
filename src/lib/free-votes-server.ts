import crypto from 'crypto'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import {
  APPWRITE,
  FREE_VOTE_REASON_MAX,
  FREE_VOTE_REASON_MIN,
  VOTE_QUANTITY_MAX_PLACEHOLDER,
  VOTE_QUANTITY_MIN,
  freeVotesEnabledOnPlatform,
} from './constants'
import {
  databaseId,
  getOrganization,
  getTenantDocument,
  listTenantDocuments,
  runInTransaction,
  type TenantContext,
} from './db'
import { findLiveRound } from './rounds-server'
import { assertCanManage, canManage } from './tenant'
import type { EventDoc, MembershipRole, NomineeDoc, RoundDoc, RoundEntryDoc, VoteDoc } from './types'

/**
 * Free votes (PRD 5.4a, CLAUDE.md rule 3a, decision #29). The only writer of
 * `source = free`. A grant is one transaction: the Vote (paymentId null,
 * grantedBy, reason), the RoundEntry increment, and the AuditLog row. It
 * never touches payments or the ledger, and it belongs to the live round
 * (rule 3b), so a closed round cannot receive one.
 */
export type FreeVoteProblem =
  | 'disabled'
  | 'eventClosed'
  | 'noLiveRound'
  | 'notInRound'
  | 'nomineeInactive'
  | 'quantityInvalid'
  | 'reasonInvalid'
  | 'keyInvalid'
  | 'wrongEvent'
  | 'roundClosed'

export class FreeVoteError extends Error {
  constructor(public readonly problem: FreeVoteProblem) {
    super(`Free votes: ${problem}`)
    this.name = 'FreeVoteError'
  }
}

export interface FreeVoteGate {
  platformEnabled: boolean
  organizationEnabled: boolean
  eventEnabled: boolean
  role: MembershipRole
}

/** All three switches on and a manager role. Pure, like the morale gate. */
export function canGrantFreeVotes(gate: FreeVoteGate): boolean {
  return gate.platformEnabled && gate.organizationEnabled && gate.eventEnabled && canManage(gate.role)
}

export interface GrantFreeVotesInput {
  nomineeId: string
  quantity: unknown
  reason: string
  /** Supplied by the form per submission; a repeat with the same key grants once. */
  idempotencyKey: string
  /** The event in the URL; a nominee from another event is refused before anything is written. */
  expectedEventId?: string
}

export function parseFreeVoteQuantity(input: unknown): number {
  const n = typeof input === 'string' ? Number(input.trim()) : input
  if (typeof n !== 'number' || !Number.isInteger(n) || n < VOTE_QUANTITY_MIN || n > VOTE_QUANTITY_MAX_PLACEHOLDER)
    throw new FreeVoteError('quantityInvalid')
  return n
}

/** Vote id for a grant: scoped to the organization so keys cannot collide across tenants. */
export function freeVoteId(organizationId: string, idempotencyKey: string): string {
  return `fv_${crypto.createHash('sha256').update(`${organizationId}:${idempotencyKey}`).digest('base64url').slice(0, 28)}`
}

class RoundNoLongerLive extends Error {}

type Doc<T> = T & Models.Document

export async function grantFreeVotes(
  ctx: TenantContext,
  input: GrantFreeVotesInput
): Promise<{ outcome: 'granted' | 'duplicate'; vote: Doc<VoteDoc> }> {
  assertCanManage(ctx)
  const quantity = parseFreeVoteQuantity(input.quantity)
  const reason = (input.reason ?? '').trim().replace(/\s+/g, ' ')
  if (reason.length < FREE_VOTE_REASON_MIN || reason.length > FREE_VOTE_REASON_MAX)
    throw new FreeVoteError('reasonInvalid')
  const key = (input.idempotencyKey ?? '').trim()
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw new FreeVoteError('keyInvalid')

  const nominee = await getTenantDocument<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, input.nomineeId)
  if (nominee.status !== 'active') throw new FreeVoteError('nomineeInactive')
  if (input.expectedEventId && nominee.eventId !== input.expectedEventId) throw new FreeVoteError('wrongEvent')
  const event = await getTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, nominee.eventId)
  if (event.status === 'closed') throw new FreeVoteError('eventClosed')

  const organization = await getOrganization(ctx.organizationId)
  const allowed = canGrantFreeVotes({
    platformEnabled: freeVotesEnabledOnPlatform(),
    organizationEnabled: organization?.freeVotesEnabled === true,
    eventEnabled: event.freeVotesEnabled === true,
    role: ctx.role,
  })
  if (!allowed) throw new FreeVoteError('disabled')

  const round = await findLiveRound(ctx, event.$id)
  if (!round) throw new FreeVoteError('noLiveRound')
  const entries = await listTenantDocuments<RoundEntryDoc>(ctx, APPWRITE.TABLES.ROUND_ENTRIES, [
    Query.equal('roundId', [round.$id]),
    Query.equal('nomineeId', [nominee.$id]),
    Query.limit(1),
  ])
  const entry = entries.documents[0]
  if (!entry) throw new FreeVoteError('notInRound')

  const { databases } = createAdminClient()
  const db = databaseId()
  const voteId = freeVoteId(ctx.organizationId, key)
  try {
    await runInTransaction(async (tx) => {
      // Rule 3b: the round must still be live at commit time, not just when we looked.
      const fresh = await databases.getDocument<Doc<RoundDoc>>(db, APPWRITE.TABLES.ROUNDS, round.$id, [], tx)
      if (fresh.status !== 'live') throw new RoundNoLongerLive()
      await databases.createDocument<Doc<VoteDoc>>(
        db,
        APPWRITE.TABLES.VOTES,
        voteId,
        {
          organizationId: ctx.organizationId,
          eventId: event.$id,
          roundId: round.$id,
          nomineeId: nominee.$id,
          paymentId: null,
          quantity,
          source: 'free',
          grantedBy: ctx.userId,
          reason,
        },
        undefined,
        tx
      )
      await databases.incrementDocumentAttribute(
        db,
        APPWRITE.TABLES.ROUND_ENTRIES,
        entry.$id,
        'voteCount',
        quantity,
        undefined,
        tx
      )
      await databases.createDocument(
        db,
        APPWRITE.TABLES.AUDIT_LOGS,
        `fva_${voteId.slice(3)}`,
        {
          actorId: ctx.userId,
          organizationId: ctx.organizationId,
          action: 'vote.grant_free',
          target: `nominees/${nominee.$id}`,
          metadata: JSON.stringify({ voteId, roundId: round.$id, eventId: event.$id, quantity, reason }),
        },
        undefined,
        tx
      )
    })
  } catch (err) {
    // The vote id (or its audit id) already exists: the same key was submitted before.
    if (err instanceof RoundNoLongerLive) throw new FreeVoteError('roundClosed')
    const existing = await databases.getDocument<Doc<VoteDoc>>(db, APPWRITE.TABLES.VOTES, voteId).catch(() => null)
    if (existing) return { outcome: 'duplicate', vote: existing }
    throw err
  }
  const vote = await withRetry(() => databases.getDocument<Doc<VoteDoc>>(db, APPWRITE.TABLES.VOTES, voteId))
  return { outcome: 'granted', vote }
}

/** Recent grants for the organizer's event page. */
export async function listFreeVoteGrants(ctx: TenantContext, eventId: string, limit = 20): Promise<Doc<VoteDoc>[]> {
  const res = await listTenantDocuments<VoteDoc>(ctx, APPWRITE.TABLES.VOTES, [
    Query.equal('eventId', [eventId]),
    Query.equal('source', ['free']),
    Query.orderDesc('$createdAt'),
    Query.limit(limit),
  ])
  return res.documents
}
