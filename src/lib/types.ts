/** Fields every Appwrite document carries. Domain document types extend this. */
export interface AppwriteDoc {
  $id: string
  /** Appwrite's monotonic row sequence (node-appwrite 22 `Models.Document`). */
  $sequence: number
  $createdAt: string
  $updatedAt: string
  $permissions: string[]
  $collectionId: string
  $databaseId: string
}

/** Every tenant-owned document carries `organizationId` (CLAUDE.md rule 4). */
export interface TenantDoc extends AppwriteDoc {
  organizationId: string
}

// ─── Platform level (DATA_MODEL.md) ───────────────────────────

/** `users` row. `$id` is the Appwrite Auth user id. */
export interface UserDoc extends AppwriteDoc {
  email: string
  fullName: string
  phone: string | null
  isSuperAdmin: boolean
}

export type OrganizationStatus = 'active' | 'suspended'

/** `organizations` row: the tenant. */
export interface OrganizationDoc extends AppwriteDoc {
  name: string
  slug: string
  logoUrl: string | null
  /** Serialized JSON; Appwrite has no JSON column type. */
  brandColors: string | null
  status: OrganizationStatus
  /** Per-organization commission override in basis points; null means the platform default (10%, decision #2). */
  commissionRate: number | null
  /** Per-organization switch for morale candidates (PRD 5.4a, #29). Super admin only. */
  moraleCandidatesEnabled: boolean
  /** Per-organization switch for free votes (PRD 5.4a, #29). Super admin only. */
  freeVotesEnabled: boolean
}

export const MEMBERSHIP_ROLES = ['owner', 'admin', 'staff', 'designer', 'scanner'] as const
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

/** `memberships` row: a user's role inside one organization. */
export interface MembershipDoc extends TenantDoc {
  userId: string
  role: MembershipRole
}

// ─── Campaigns (DATA_MODEL.md) ────────────────────────────────

export const EVENT_STATUSES = ['draft', 'scheduled', 'live', 'paused', 'closed'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export const RESULTS_VISIBILITIES = ['hidden', 'ranking', 'percentage', 'count'] as const
export type ResultsVisibility = (typeof RESULTS_VISIBILITIES)[number]

export interface EventDoc extends TenantDoc {
  title: string
  slug: string
  description: string | null
  coverImageUrl: string | null
  /** USSD ticket branch only; null until ticketing lands. */
  eventCode: string | null
  /** Integer pesewas (CLAUDE.md rule 6). */
  votePrice: number
  startsAt: string
  endsAt: string
  status: EventStatus
  resultsVisibility: ResultsVisibility
  resultsPublishedAt: string | null
  /** Per-event switch for morale candidates (PRD 5.4a, #29). */
  moraleCandidatesEnabled: boolean
  /** The organizer's per-event opt-in for free votes (PRD 5.4a, #29). */
  freeVotesEnabled: boolean
}

export const ROUND_STATUSES = ['pending', 'live', 'closed'] as const
export type RoundStatus = (typeof ROUND_STATUSES)[number]

export interface RoundDoc extends TenantDoc {
  eventId: string
  number: number
  name: string
  startsAt: string | null
  endsAt: string | null
  status: RoundStatus
  closedAt: string | null
  /**
   * Pesewas per vote in this round; null or absent means the event's price (decision #30).
   * Optional: rounds are created without it and it is only written when the organizer sets one.
   */
  votePrice?: number | null
}

export interface CategoryDoc extends TenantDoc {
  eventId: string
  name: string
  order: number
}

export type NomineeStatus = 'active' | 'withdrawn'

export interface NomineeDoc extends TenantDoc {
  eventId: string
  categoryId: string
  name: string
  /** Platform-wide unique (decision #12). */
  code: string
  photoUrl: string | null
  /**
   * Where the photo is anchored in the flyer's frame, percent; null or absent = centre
   * (`photo-focus.ts`). Optional: rows are created without them and they are only written
   * when someone moves the photo.
   */
  photoFocusX?: number | null
  photoFocusY?: number | null
  /** Zoom in percent, 100 to 300; null or absent = 100. */
  photoZoom?: number | null
  bio: string | null
  status: NomineeStatus
  isMorale: boolean
  /** The nominee's Auth user id once invited; the portal's only access key. */
  userId: string | null
  profileCompletedAt: string | null
  email: string | null
  /** SHA-256 of the one-time claim token; null once claimed or never invited. */
  inviteTokenHash: string | null
  inviteExpiresAt: string | null
  inviteSentAt: string | null
  claimedAt: string | null
}

export interface RoundEntryDoc extends TenantDoc {
  eventId: string
  roundId: string
  nomineeId: string
  /** Cached tally. Only the vote pipeline changes it. */
  voteCount: number
}

// ─── Operations ───────────────────────────────────────────────

export interface AuditLogDoc extends AppwriteDoc {
  organizationId: string | null
  actorId: string
  action: string
  target: string
  /** Serialized JSON. */
  metadata: string | null
}

// ─── Payments and votes (DATA_MODEL.md, USSD_AND_PAYMENTS.md) ──

export type PaymentChannel = 'web' | 'ussd'
export type PaymentPurpose = 'vote' | 'ticket'
export type PaymentStatus = 'pending' | 'success' | 'failed' | 'refunded'

export interface PaymentDoc extends TenantDoc {
  eventId: string
  /** The round that was live when a vote payment was initiated (rule 4a); null for tickets. */
  roundId: string | null
  nomineeId: string | null
  /** For ticket payments. */
  tierId: string | null
  payerName: string | null
  channel: PaymentChannel
  purpose: PaymentPurpose
  payerPhone: string
  payerEmail: string | null
  network: string | null
  quantity: number
  /** Pesewas. */
  amount: number
  platformFee: number
  organizerNet: number
  /**
   * The payment provider's charge taken off the top at confirmation (decision #36); null or
   * absent when none was reported. `providerFee + platformFee + organizerNet === amount`.
   */
  providerFee?: number | null
  provider: string
  /** Unique; the idempotency key for callbacks (rule 5). */
  providerReference: string
  status: PaymentStatus
  confirmedAt: string | null
  /** Serialized raw callback payload (rule 7). */
  rawCallback: string | null
}

export type VoteSource = 'paid' | 'free'

export interface VoteDoc extends TenantDoc {
  eventId: string
  roundId: string
  nomineeId: string
  /** Required for paid votes; null for free votes. */
  paymentId: string | null
  quantity: number
  source: VoteSource
  grantedBy: string | null
  reason: string | null
}

export type LedgerEntryType = 'vote_credit' | 'ticket_credit' | 'payout_debit' | 'adjustment'

export interface LedgerEntryDoc extends TenantDoc {
  type: LedgerEntryType
  /** Pesewas; credits positive, debits negative. */
  amount: number
  paymentId: string | null
  note: string | null
}

// ─── USSD ─────────────────────────────────────────────────────

export interface UssdSessionDoc extends AppwriteDoc {
  /** The aggregator's session id. */
  sessionId: string
  /** E.164 digits, from the aggregator, never typed by the caller. */
  phone: string
  network: string | null
  /** Serialized `MenuState`. */
  state: string
  lastStep: string
  status: 'active' | 'released'
  expiresAt: string
}

// ─── Flyer engine (FLYER_ENGINE.md) ───────────────────────────

export interface FlyerTemplateDoc extends TenantDoc {
  eventId: string
  categoryId: string | null
  name: string
  width: number
  height: number
  backgroundFileId: string | null
  /** Drawn over the photo, under the text: the design's layers that sit above the photo (a frame, an overlapping graphic). Transparent PNG, template size. */
  foregroundFileId?: string | null
  /** Alpha mask for a photo slot with shape `mask`: the photo shows where it is opaque. */
  photoMaskFileId?: string | null
  /** Serialized slot model (`src/lib/flyer/model.ts`). */
  canvasJson: string
  status: 'draft' | 'published'
  version: number
}

export interface FontDoc extends AppwriteDoc {
  organizationId: string | null
  family: string
  fileId: string
  weight: number
  style: 'normal' | 'italic'
}

export interface GeneratedFlyerDoc extends TenantDoc {
  nomineeId: string
  templateId: string
  templateVersion: number
  fileId: string
  sourceHash: string
}

// ─── Ticketing (PRD 5.4b) ─────────────────────────────────────

export interface TicketTierDoc extends TenantDoc {
  eventId: string
  name: string
  /** Pesewas. */
  price: number
  /** null = unlimited. */
  quantityAvailable: number | null
  quantitySold: number
  salesStart: string | null
  salesEnd: string | null
  status: 'active' | 'hidden'
  order: number
}

export type TicketStatus = 'valid' | 'used' | 'cancelled'

export interface TicketDoc extends TenantDoc {
  eventId: string
  tierId: string
  paymentId: string
  buyerName: string | null
  buyerPhone: string
  buyerEmail: string | null
  /** Signed token, never the bare id. */
  qrToken: string
  status: TicketStatus
  usedAt: string | null
  scannedBy: string | null
  emailSentAt: string | null
}

export interface TicketScanDoc extends TenantDoc {
  eventId: string
  ticketId: string
  scannedBy: string
}

// ─── Payouts (PRD 5.6) ────────────────────────────────────────

export type PayoutStatus = 'requested' | 'approved' | 'paid' | 'rejected'
export type PayoutDestination =
  | { kind: 'momo'; phone: string; name: string }
  | { kind: 'bank'; bankName: string; accountNumber: string; accountName: string }

export interface PayoutDoc extends TenantDoc {
  /** Pesewas. */
  amount: number
  destinationKind: 'momo' | 'bank'
  /** Serialized `PayoutDestination`. */
  destination: string
  status: PayoutStatus
  requestedBy: string
  decidedBy: string | null
  note: string | null
  decidedAt: string | null
  paidAt: string | null
}

// ─── Team invites (PRD 5.1) ───────────────────────────────────

export type InvitableRole = Exclude<MembershipRole, 'owner'>

export interface TeamInviteDoc extends TenantDoc {
  email: string
  role: InvitableRole
  /** SHA-256 of the one-time token; null once accepted or revoked. */
  tokenHash: string | null
  expiresAt: string | null
  invitedBy: string
  status: 'pending' | 'accepted' | 'revoked'
  acceptedBy: string | null
  acceptedAt: string | null
}
