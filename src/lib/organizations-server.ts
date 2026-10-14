import { ID } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { APPWRITE } from './constants'
import { databaseId, getOrganizationBySlug } from './db'
import { slugify, validateSlug, type SlugProblem } from './slug'
import type { MembershipDoc, OrganizationDoc } from './types'

/**
 * Self-serve workspace creation (PRD 5.1, decision #9): the caller becomes the
 * `owner` of a new, immediately `active` organization.
 *
 * Server-only. Runs with the admin client, so identity must come from the
 * session (the route passes the session user id), never from the body.
 */
export const ORG_NAME_MIN = 2
export const ORG_NAME_MAX = 120

export type CreateOrganizationProblem = 'nameTooShort' | 'nameTooLong' | 'slugTaken' | `slug.${SlugProblem}`

export class CreateOrganizationError extends Error {
  constructor(public readonly problem: CreateOrganizationProblem) {
    super(`Cannot create organization: ${problem}`)
    this.name = 'CreateOrganizationError'
  }
}

export interface CreateOrganizationInput {
  name: string
  /** Optional; derived from the name when absent. */
  slug?: string
}

export function normalizeCreateOrganizationInput(input: CreateOrganizationInput): { name: string; slug: string } {
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ')
  if (name.length < ORG_NAME_MIN) throw new CreateOrganizationError('nameTooShort')
  if (name.length > ORG_NAME_MAX) throw new CreateOrganizationError('nameTooLong')

  const slug = (input.slug ?? '').trim() ? (input.slug as string).trim().toLowerCase() : slugify(name)
  const problem = validateSlug(slug)
  if (problem) throw new CreateOrganizationError(`slug.${problem}`)
  return { name, slug }
}

function isConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: number }).code === 409
}

export async function createOrganizationWithOwner(
  ownerUserId: string,
  input: CreateOrganizationInput
): Promise<{ organization: OrganizationDoc; membership: MembershipDoc }> {
  if (!ownerUserId) throw new Error('ownerUserId is required')
  const { name, slug } = normalizeCreateOrganizationInput(input)

  // Friendly pre-check; the unique index on `slug` is the real guarantee.
  if (await getOrganizationBySlug(slug)) throw new CreateOrganizationError('slugTaken')

  const { databases } = createAdminClient()
  const db = databaseId()

  let organization: OrganizationDoc
  try {
    organization = await withRetry(() =>
      databases.createDocument<OrganizationDoc>(db, APPWRITE.TABLES.ORGANIZATIONS, ID.unique(), {
        name,
        slug,
        status: 'active',
        logoUrl: null,
        brandColors: null,
        commissionRate: null,
      })
    )
  } catch (err) {
    if (isConflict(err)) throw new CreateOrganizationError('slugTaken')
    throw err
  }

  // Two writes, no transaction: an organization nobody owns is unreachable, so
  // roll it back if the membership write fails.
  try {
    const membership = await withRetry(() =>
      databases.createDocument<MembershipDoc>(db, APPWRITE.TABLES.MEMBERSHIPS, ID.unique(), {
        userId: ownerUserId,
        organizationId: organization.$id,
        role: 'owner',
      })
    )
    return { organization, membership }
  } catch (err) {
    await databases.deleteDocument(db, APPWRITE.TABLES.ORGANIZATIONS, organization.$id).catch(() => {})
    throw err
  }
}
