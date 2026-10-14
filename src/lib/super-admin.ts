import { getSessionUserId } from './auth-session'
import { getUserDoc } from './db'
import { ForbiddenError } from './tenant'

/**
 * The platform owner (PRD 4 "Super admin"). The flag lives on the `users`
 * row and nothing in the app sets it: the first super admin is flagged in
 * the Appwrite console. Checked from the session, never from a request.
 */
export async function isSuperAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false
  const user = await getUserDoc(userId)
  return user?.isSuperAdmin === true
}

/** Null without a session; throws for a signed-in non-admin; the user id otherwise. */
export async function requireSuperAdmin(): Promise<string | null> {
  const userId = await getSessionUserId()
  if (!userId) return null
  if (!(await isSuperAdmin(userId))) throw new ForbiddenError('Super admin only')
  return userId
}
