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
  },
} as const
