// ─── Appwrite IDs ─────────────────────────────────────────────
// Same shape as pickLT's `constants.ts`. Table ids are slugs fixed in
// `appwrite.config.json`, so they are stable across environments and need no
// env var each. Only the database id is read from the environment.
export const APPWRITE = {
  PROJECT_ID: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!,
  DATABASE_ID: process.env.APPWRITE_DATABASE_ID!,

  TABLES: {
    USERS: 'users',
    ORGANIZATIONS: 'organizations',
    MEMBERSHIPS: 'memberships',
    EVENTS: 'events',
    ROUNDS: 'rounds',
    CATEGORIES: 'categories',
    NOMINEES: 'nominees',
    ROUND_ENTRIES: 'round_entries',
    AUDIT_LOGS: 'audit_logs',
    PAYMENTS: 'payments',
    VOTES: 'votes',
    LEDGER_ENTRIES: 'ledger_entries',
    USSD_SESSIONS: 'ussd_sessions',
    FLYER_TEMPLATES: 'flyer_templates',
    FONTS: 'fonts',
    GENERATED_FLYERS: 'generated_flyers',
    TICKET_TIERS: 'ticket_tiers',
    TICKETS: 'tickets',
    TICKET_SCANS: 'ticket_scans',
    PAYOUTS: 'payouts',
    PAYOUT_LOCKS: 'payout_locks',
    TEAM_INVITES: 'team_invites',
    RATE_LIMITS: 'rate_limits',
  },

  BUCKETS: {
    NOMINEE_PHOTOS: 'nominee-photos',
    FLYER_TEMPLATES: 'flyer-templates',
    FONTS: 'fonts',
    FLYERS: 'flyers',
    ORG_LOGOS: 'org-logos',
  },
} as const

/**
 * Platform-wide switch for morale candidates (PRD 5.4a, decision #29). On
 * unless the env var is exactly "false": the super admin's kill switch. The
 * organization switch and the organizer's per-event opt-in sit under it.
 */
export function moraleCandidatesEnabledOnPlatform(): boolean {
  return process.env.MORALE_CANDIDATES_ENABLED !== 'false'
}

/** Same for free votes: on unless `FREE_VOTES_ENABLED` is exactly "false". */
export function freeVotesEnabledOnPlatform(): boolean {
  return process.env.FREE_VOTES_ENABLED !== 'false'
}

/** Reason text on a free-vote grant (PRD 5.4a). */
export const FREE_VOTE_REASON_MIN = 3
export const FREE_VOTE_REASON_MAX = 500

/**
 * The most free votes an admin can grant at once (PRD 5.4a, "e.g. 1,000 at
 * once"). A technical ceiling, not the paid limit: paid votes are capped by
 * amount per payment (decision #16, `vote-limits.ts`).
 */
export const VOTE_QUANTITY_MIN = 1
export const VOTE_QUANTITY_MAX_PLACEHOLDER = 10_000

/** PLACEHOLDER like #16: a technical ceiling on tickets per purchase. */
export const TICKET_QUANTITY_MAX_PLACEHOLDER = 20

/**
 * Minimum payout in pesewas, set per deployment from env (decision #3); no
 * default, so there is no minimum until it is set.
 */
export function payoutMinimumPesewas(): number {
  const raw = process.env.PAYOUT_MIN_PESEWAS
  const n = raw ? Number(raw) : 0
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}
