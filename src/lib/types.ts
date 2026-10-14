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
  /** Per-organization commission override. Unit and default are OPEN_QUESTIONS #2. */
  commissionRate: number | null
  /** Per-organization switch for morale candidates (PRD 5.4a, #29). Super admin only. */
  moraleCandidatesEnabled: boolean
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
  /** The round that was live when the payment was initiated (rule 4a). */
  roundId: string
  nomineeId: string | null
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
