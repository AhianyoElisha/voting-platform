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
