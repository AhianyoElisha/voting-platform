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
  },

  BUCKETS: {
    NOMINEE_PHOTOS: 'nominee-photos',
    FLYER_TEMPLATES: 'flyer-templates',
    FONTS: 'fonts',
    FLYERS: 'flyers',
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

/**
 * PLACEHOLDER for OPEN_QUESTIONS #16 (minimum and maximum votes per
 * transaction). The minimum is 1 by nature; the ceiling here is a technical
 * guard against absurd debits, not a product decision.
 */
export const VOTE_QUANTITY_MIN = 1
export const VOTE_QUANTITY_MAX_PLACEHOLDER = 10_000

/** PLACEHOLDER like #16: a technical ceiling on tickets per purchase. */
export const TICKET_QUANTITY_MAX_PLACEHOLDER = 20
