import { createAdminClient, withRetry } from './appwrite-server'
import { APPWRITE } from './constants'
import { databaseId, getUserDoc } from './db'

export const FULL_NAME_MIN = 2
export const FULL_NAME_MAX = 120

export type AccountProblem = 'nameTooShort' | 'nameTooLong'

export class AccountError extends Error {
  constructor(public readonly problem: AccountProblem) {
    super(`Account: ${problem}`)
    this.name = 'AccountError'
  }
}

/** The name as it will be stored, or the reason it is refused. */
export function parseFullName(input: unknown): string {
  const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : ''
  if (name.length < FULL_NAME_MIN) throw new AccountError('nameTooShort')
  if (name.length > FULL_NAME_MAX) throw new AccountError('nameTooLong')
  return name
}

/**
 * Change the signed-in user's own display name. The Auth account is the
 * source (`/api/auth/sync-user` copies it into the `users` row on sign-in),
 * so both are written. `userId` must come from the session, never the body.
 */
export async function updateOwnName(userId: string, input: unknown): Promise<string> {
  const fullName = parseFullName(input)
  const { databases, users } = createAdminClient()
  await withRetry(() => users.updateName(userId, fullName))
  if (await getUserDoc(userId)) {
    await withRetry(() => databases.updateDocument(databaseId(), APPWRITE.TABLES.USERS, userId, { fullName }))
  }
  return fullName
}
