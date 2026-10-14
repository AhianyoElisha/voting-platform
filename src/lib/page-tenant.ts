import { notFound, redirect } from 'next/navigation'
import { getSessionUserId } from './auth-session'
import { getOrganizationBySlug, type TenantContext } from './db'
import { NotAMemberError, getTenantContext } from './tenant'
import type { OrganizationDoc } from './types'

/**
 * Resolves `/dashboard/[orgSlug]/...` for server components: the session user
 * must be a member of the organization behind the slug. A non-member gets a
 * 404 rather than a 403, so slugs leak nothing about workspaces that exist.
 */
export async function resolveWorkspace(
  orgSlug: string,
  path: string
): Promise<{ ctx: TenantContext; organization: OrganizationDoc }> {
  const userId = await getSessionUserId()
  if (!userId) redirect(`/login?redirect=${encodeURIComponent(path)}`)

  const organization = await getOrganizationBySlug(orgSlug)
  if (!organization) notFound()

  try {
    const ctx = await getTenantContext(userId, organization.$id)
    return { ctx, organization }
  } catch (err) {
    if (err instanceof NotAMemberError) notFound()
    throw err
  }
}
