import { ID, Permission, Role } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { writeAuditLog } from './audit'
import { isHexColor, parseBrandColors, serializeBrandColors } from './branding'
import { APPWRITE } from './constants'
import { databaseId, getOrganization, getOrganizationBySlug, type TenantContext } from './db'
import { slugify, validateSlug, type SlugProblem } from './slug'
import { assertCanManage } from './tenant'
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
        moraleCandidatesEnabled: true,
        freeVotesEnabled: true,
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

// ─── Settings (PRD 5.1: name and branding) ─────────────────────

export class OrganizationSettingsError extends Error {
  constructor(public readonly problem: 'nameInvalid' | 'colorInvalid' | 'badImage' | 'noChange') {
    super(problem)
    this.name = 'OrganizationSettingsError'
  }
}

export const LOGO_MAX_BYTES = 5 * 1024 * 1024
const LOGO_MAX_DIMENSION = 800

/**
 * Owner or admin: rename the organization or set its brand colours. The slug
 * does not change here: it is printed on flyers and in every shared link.
 * Audited (`organization.profile`).
 */
export async function updateOrganizationProfile(
  ctx: TenantContext,
  input: { name?: unknown; brandColors?: unknown }
): Promise<OrganizationDoc> {
  assertCanManage(ctx)
  const current = await getOrganization(ctx.organizationId)
  if (!current) throw new OrganizationSettingsError('nameInvalid')
  const changes: Partial<Pick<OrganizationDoc, 'name' | 'brandColors'>> = {}
  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : ''
    if (name.length < 2 || name.length > 120) throw new OrganizationSettingsError('nameInvalid')
    if (name !== current.name) changes.name = name
  }
  if (input.brandColors !== undefined) {
    let next: string | null = null
    if (input.brandColors !== null) {
      const c = input.brandColors as { primary?: unknown; accent?: unknown }
      if (!isHexColor(c?.primary) || (c.accent != null && !isHexColor(c.accent))) {
        throw new OrganizationSettingsError('colorInvalid')
      }
      next = serializeBrandColors({ primary: c.primary, accent: (c.accent as string | null | undefined) ?? null })
    }
    if (next !== (serializeBrandColors(parseBrandColors(current.brandColors)) ?? null)) changes.brandColors = next
  }
  if (Object.keys(changes).length === 0) throw new OrganizationSettingsError('noChange')
  const { databases } = createAdminClient()
  const updated = await withRetry(() =>
    databases.updateDocument<OrganizationDoc>(databaseId(), APPWRITE.TABLES.ORGANIZATIONS, ctx.organizationId, changes)
  )
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'organization.profile',
    target: `organizations/${ctx.organizationId}`,
    metadata: { fields: Object.keys(changes), ...(changes.name ? { from: current.name, to: changes.name } : {}) },
  })
  return updated
}

/** The file id inside a logo URL this module wrote, so the old file can be deleted. */
export function logoFileId(logoUrl: string | null | undefined): string | null {
  const m = logoUrl?.match(/\/buckets\/org-logos\/files\/([^/]+)\/view/)
  return m ? m[1] : null
}

/**
 * Owner or admin: set (PNG, JPEG or WebP; stored as PNG up to 800 px so
 * transparency survives) or remove (`image` null) the logo. `logoUrl` is the
 * file's public view URL, which the public pages and the PDF report use.
 */
export async function setOrganizationLogo(ctx: TenantContext, image: Uint8Array | null): Promise<OrganizationDoc> {
  assertCanManage(ctx)
  const current = await getOrganization(ctx.organizationId)
  if (!current) throw new OrganizationSettingsError('badImage')
  const { storage, databases } = createAdminClient()
  let logoUrl: string | null = null
  if (image) {
    if (image.length > LOGO_MAX_BYTES) throw new OrganizationSettingsError('badImage')
    const sharp = (await import('sharp')).default
    let png: Uint8Array
    try {
      png = new Uint8Array(
        await sharp(image)
          .rotate()
          .resize(LOGO_MAX_DIMENSION, LOGO_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer()
      )
    } catch {
      throw new OrganizationSettingsError('badImage')
    }
    const { InputFile } = await import('node-appwrite/file')
    const file = await withRetry(() =>
      storage.createFile(APPWRITE.BUCKETS.ORG_LOGOS, ID.unique(), InputFile.fromBuffer(png, 'logo.png'), [
        Permission.read(Role.any()),
      ])
    )
    const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? ''
    const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? ''
    logoUrl = `${endpoint}/storage/buckets/${APPWRITE.BUCKETS.ORG_LOGOS}/files/${file.$id}/view?project=${project}`
  }
  const updated = await withRetry(() =>
    databases.updateDocument<OrganizationDoc>(databaseId(), APPWRITE.TABLES.ORGANIZATIONS, ctx.organizationId, {
      logoUrl,
    })
  )
  const old = logoFileId(current.logoUrl)
  if (old) await storage.deleteFile(APPWRITE.BUCKETS.ORG_LOGOS, old).catch(() => {})
  await writeAuditLog({
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    action: 'organization.profile',
    target: `organizations/${ctx.organizationId}`,
    metadata: { fields: ['logo'], removed: !image },
  })
  return updated
}
