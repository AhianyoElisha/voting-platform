import { Query } from 'node-appwrite'
import { writeAuditLog } from './audit'
import { APPWRITE, moraleCandidatesEnabledOnPlatform } from './constants'
import {
  createTenantDocument,
  getOrganization,
  getTenantDocument,
  listTenantDocuments,
  updateTenantDocument,
  type TenantContext,
} from './db'
import { allocateNomineeCode, isNomineeCodeTaken } from './nominee-code'
import { releaseInviteAccount } from './nominee-invite-server'
import { focusColumns, focusOf, parsePhotoFocus, sameFocus } from './photo-focus'
import { storeNomineePhoto } from './portal-server'
import { assertCanManage, canManage } from './tenant'
import type { CategoryDoc, EventDoc, MembershipRole, NomineeDoc, RoundDoc, RoundEntryDoc } from './types'

/**
 * Categories and nominees (PRD 5.2) and morale candidates (PRD 5.4a, behind
 * switches, publicly disclosed per decision #29).
 */
export type NomineeProblem =
  | 'nameTooShort'
  | 'nameTooLong'
  | 'bioTooLong'
  | 'eventClosed'
  | 'categoryNotInEvent'
  | 'moraleDisabled'
  | 'codeExhausted'
  | 'emailInvalid'
  | 'notInEvent'
  | 'emailLocked'
  | 'focusInvalid'

export class NomineeError extends Error {
  constructor(public readonly problem: NomineeProblem) {
    super(`Nominee: ${problem}`)
    this.name = 'NomineeError'
  }
}

// ─── Categories ────────────────────────────────────────────────

export async function listCategories(ctx: TenantContext, eventId: string): Promise<CategoryDoc[]> {
  const res = await listTenantDocuments<CategoryDoc>(ctx, APPWRITE.TABLES.CATEGORIES, [
    Query.equal('eventId', [eventId]),
    Query.orderAsc('order'),
    Query.limit(100),
  ])
  return res.documents
}

export async function createCategory(ctx: TenantContext, eventId: string, name: string): Promise<CategoryDoc> {
  assertCanManage(ctx)
  const event = await getTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, eventId)
  if (event.status === 'closed') throw new NomineeError('eventClosed')

  const clean = (name ?? '').trim().replace(/\s+/g, ' ')
  if (clean.length < 2) throw new NomineeError('nameTooShort')
  if (clean.length > 120) throw new NomineeError('nameTooLong')

  const existing = await listCategories(ctx, eventId)
  const order = existing.reduce((max, c) => Math.max(max, c.order), 0) + 1
  return createTenantDocument<CategoryDoc>(ctx, APPWRITE.TABLES.CATEGORIES, { eventId, name: clean, order })
}

// ─── Morale gating (PRD 5.4a safeguards) ──────────────────────

export interface MoraleGate {
  platformEnabled: boolean
  organizationEnabled: boolean
  eventEnabled: boolean
  role: MembershipRole
}

/** All three switches on and a manager role. Pure, so it is easy to test. */
export function canCreateMoraleCandidate(gate: MoraleGate): boolean {
  return gate.platformEnabled && gate.organizationEnabled && gate.eventEnabled && canManage(gate.role)
}

// ─── Nominees ──────────────────────────────────────────────────

export interface CreateNomineeInput {
  eventId: string
  categoryId: string
  name: string
  bio?: string
  /** Needed to invite the nominee to the portal; optional at creation. */
  email?: string
  isMorale?: boolean
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(input: string | undefined): string | null {
  const email = (input ?? '').trim().toLowerCase()
  if (!email) return null
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new NomineeError('emailInvalid')
  return email
}

export async function listNominees(ctx: TenantContext, eventId: string): Promise<NomineeDoc[]> {
  const res = await listTenantDocuments<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, [
    Query.equal('eventId', [eventId]),
    Query.orderAsc('$createdAt'),
    Query.limit(500),
  ])
  return res.documents
}

function isConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: number }).code === 409
}

/**
 * Creates the nominee with a platform-wide unique code and its round 1 entry.
 * A nominee added after round 1 closed gets no entry: placing nominees into
 * later rounds is OPEN_QUESTIONS #30.
 */
export async function createNominee(
  ctx: TenantContext,
  input: CreateNomineeInput
): Promise<{ nominee: NomineeDoc; entry: RoundEntryDoc | null }> {
  assertCanManage(ctx)
  const event = await getTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, input.eventId)
  if (event.status === 'closed') throw new NomineeError('eventClosed')

  const category = await getTenantDocument<CategoryDoc>(ctx, APPWRITE.TABLES.CATEGORIES, input.categoryId)
  if (category.eventId !== event.$id) throw new NomineeError('categoryNotInEvent')

  const name = (input.name ?? '').trim().replace(/\s+/g, ' ')
  if (name.length < 2) throw new NomineeError('nameTooShort')
  if (name.length > 120) throw new NomineeError('nameTooLong')
  const bio = (input.bio ?? '').trim() || null
  if (bio && bio.length > 2000) throw new NomineeError('bioTooLong')
  const email = normalizeEmail(input.email)

  const isMorale = input.isMorale === true
  if (isMorale) {
    const organization = await getOrganization(ctx.organizationId)
    const allowed = canCreateMoraleCandidate({
      platformEnabled: moraleCandidatesEnabledOnPlatform(),
      organizationEnabled: organization?.moraleCandidatesEnabled === true,
      eventEnabled: event.moraleCandidatesEnabled === true,
      role: ctx.role,
    })
    if (!allowed) throw new NomineeError('moraleDisabled')
  }

  // The unique index on `code` is the guarantee; the pre-check just keeps
  // retries rare. Three inserts is plenty for a sparse 4-digit space.
  let nominee: NomineeDoc | null = null
  for (let attempt = 0; attempt < 3 && !nominee; attempt++) {
    const code = await allocateNomineeCode(isNomineeCodeTaken)
    try {
      nominee = await createTenantDocument<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, {
        eventId: event.$id,
        categoryId: category.$id,
        name,
        code,
        photoUrl: null,
        bio,
        status: 'active',
        isMorale,
        userId: null,
        profileCompletedAt: null,
        email,
        inviteTokenHash: null,
        inviteExpiresAt: null,
        inviteSentAt: null,
        claimedAt: null,
      })
    } catch (err) {
      if (!isConflict(err)) throw err
    }
  }
  if (!nominee) throw new NomineeError('codeExhausted')

  if (isMorale) {
    await writeAuditLog({
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      action: 'nominee.create_morale',
      target: `nominees/${nominee.$id}`,
      metadata: { eventId: event.$id, categoryId: category.$id, name },
    })
  }

  const roundOne = await listTenantDocuments<RoundDoc>(ctx, APPWRITE.TABLES.ROUNDS, [
    Query.equal('eventId', [event.$id]),
    Query.equal('number', [1]),
    Query.limit(1),
  ])
  const round = roundOne.documents[0]
  let entry: RoundEntryDoc | null = null
  if (round && round.status !== 'closed') {
    entry = await createTenantDocument<RoundEntryDoc>(ctx, APPWRITE.TABLES.ROUND_ENTRIES, {
      eventId: event.$id,
      roundId: round.$id,
      nomineeId: nominee.$id,
      voteCount: 0,
    })
  }

  return { nominee, entry }
}

export async function listRoundEntries(ctx: TenantContext, roundId: string): Promise<RoundEntryDoc[]> {
  const res = await listTenantDocuments<RoundEntryDoc>(ctx, APPWRITE.TABLES.ROUND_ENTRIES, [
    Query.equal('roundId', [roundId]),
    Query.limit(500),
  ])
  return res.documents
}

// ─── Editing (organizer side) ─────────────────────────────────

/**
 * The nominee, checked against the organization (tenant scope), the event in
 * the URL and the event being open. Managers only.
 */
async function editableNominee(ctx: TenantContext, eventId: string, nomineeId: string): Promise<NomineeDoc> {
  assertCanManage(ctx)
  const nominee = await getTenantDocument<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, nomineeId)
  if (nominee.eventId !== eventId) throw new NomineeError('notInEvent')
  const event = await getTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, eventId)
  if (event.status === 'closed') throw new NomineeError('eventClosed')
  return nominee
}

export interface UpdateNomineeInput {
  name?: string
  bio?: string
  /** Empty string clears it. */
  email?: string
  /** Untrusted; where the photo is anchored on the flyer (`photo-focus.ts`). */
  photoFocus?: unknown
}

/**
 * Organizer edits to name, bio and portal email. Category, code and the
 * morale flag are not editable here: the code is printed on flyers, and
 * moving or re-flagging a nominee touches tallies and disclosures.
 *
 * Email: once the nominee has claimed the portal it is their login and stays
 * fixed. Before that, a change drops any pending invite, so the old link dies
 * and the next invite goes to the new address; the account the invite made
 * for the old address is deleted (`releaseInviteAccount`).
 */
export async function updateNominee(
  ctx: TenantContext,
  eventId: string,
  nomineeId: string,
  input: UpdateNomineeInput
): Promise<NomineeDoc> {
  const nominee = await editableNominee(ctx, eventId, nomineeId)
  const data: Partial<NomineeDoc> = {}
  if (input.name !== undefined) {
    const name = input.name.trim().replace(/\s+/g, ' ')
    if (name.length < 2) throw new NomineeError('nameTooShort')
    if (name.length > 120) throw new NomineeError('nameTooLong')
    if (name !== nominee.name) data.name = name
  }
  if (input.bio !== undefined) {
    const bio = input.bio.trim() || null
    if (bio && bio.length > 2000) throw new NomineeError('bioTooLong')
    if (bio !== nominee.bio) data.bio = bio
  }
  if (input.email !== undefined) {
    const email = normalizeEmail(input.email)
    if (email !== nominee.email) {
      if (nominee.claimedAt) throw new NomineeError('emailLocked')
      Object.assign(data, { email, userId: null, inviteTokenHash: null, inviteExpiresAt: null, inviteSentAt: null })
    }
  }
  if (input.photoFocus !== undefined) {
    const focus = parsePhotoFocus(input.photoFocus)
    if (!focus) throw new NomineeError('focusInvalid')
    if (!sameFocus(focus, focusOf(nominee))) Object.assign(data, focusColumns(focus, nominee))
  }
  if (Object.keys(data).length === 0) return nominee

  const updated = await updateTenantDocument<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, nominee.$id, data)
  // After the row no longer points at it, so the "still in use" check sees it free.
  const accountReleased = 'userId' in data && nominee.userId ? await releaseInviteAccount(nominee.userId) : false
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'nominee.update',
    target: `nominees/${nominee.$id}`,
    // Field names only: the values are personal data and already on the row.
    metadata: {
      eventId,
      fields: Object.keys(data)
        .filter((k) => ['name', 'bio', 'email', 'photoFocusX', 'photoZoom'].includes(k))
        .map((k) => (k === 'photoFocusX' ? 'photoFocus' : k)),
      ...(accountReleased ? { accountReleased } : {}),
    },
  })
  return updated
}

/**
 * The organizer uploads the nominee's photo (FLYER_ENGINE.md "Generation"),
 * for nominees who will not use the portal. It does not mark the nominee's
 * own profile complete.
 */
export async function setNomineePhoto(
  ctx: TenantContext,
  eventId: string,
  nomineeId: string,
  input: Uint8Array
): Promise<NomineeDoc> {
  const nominee = await editableNominee(ctx, eventId, nomineeId)
  const updated = await storeNomineePhoto(nominee, input)
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'nominee.photo',
    target: `nominees/${nominee.$id}`,
    metadata: { eventId, replaced: !!nominee.photoUrl },
  })
  return updated
}
