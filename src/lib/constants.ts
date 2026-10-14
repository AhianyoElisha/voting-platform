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
  },
} as const

/**
 * Platform-wide kill switch for morale candidates (PRD 5.4a, OPEN_QUESTIONS
 * #29). Off unless the env var is exactly "true". The organization and event
 * switches sit under this one.
 */
export function moraleCandidatesEnabledOnPlatform(): boolean {
  return process.env.MORALE_CANDIDATES_ENABLED === 'true'
}

/**
 * PLACEHOLDER for OPEN_QUESTIONS #16 (minimum and maximum votes per
 * transaction). The minimum is 1 by nature; the ceiling here is a technical
 * guard against absurd debits, not a product decision.
 */
export const VOTE_QUANTITY_MIN = 1
export const VOTE_QUANTITY_MAX_PLACEHOLDER = 10_000
