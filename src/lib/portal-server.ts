import { ID, Permission, Query, Role } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { APPWRITE } from './constants'
import { databaseId } from './db'
import { normalizePhoto } from './photo'
import type { CategoryDoc, EventDoc, NomineeDoc, OrganizationDoc } from './types'

/**
 * Nominee portal access (PRD 5.2a). Nominees have no Membership; the only
 * key is `Nominee.userId === session user`, checked here for every read and
 * write (integrity checklist: "nominee portal users can only read/write their
 * own Nominee row").
 *
 * OPEN_QUESTIONS #33: vote counts are not exposed here, and profile edits
 * stay open since no flyer exists yet to regenerate.
 */
export class NotOwnNomineeError extends Error {
  constructor() {
    super('Nominee does not belong to the signed-in user')
    this.name = 'NotOwnNomineeError'
  }
}

export type ProfileProblem = 'nameTooShort' | 'nameTooLong' | 'bioTooLong'

export class ProfileError extends Error {
  constructor(public readonly problem: ProfileProblem) {
    super(`Profile: ${problem}`)
    this.name = 'ProfileError'
  }
}

const db = () => databaseId()

export async function listOwnNominees(userId: string): Promise<NomineeDoc[]> {
  if (!userId) return []
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<NomineeDoc>(db(), APPWRITE.TABLES.NOMINEES, [
      Query.equal('userId', [userId]),
      Query.limit(50),
    ])
  )
  return res.documents
}

/** The nominee row, only if it belongs to the caller. Anything else is a refusal, never a hint. */
export async function requireOwnNominee(userId: string, nomineeId: string): Promise<NomineeDoc> {
  if (!userId || !nomineeId) throw new NotOwnNomineeError()
  const { databases } = createAdminClient()
  let nominee: NomineeDoc
  try {
    nominee = await withRetry(() => databases.getDocument<NomineeDoc>(db(), APPWRITE.TABLES.NOMINEES, nomineeId))
  } catch (err) {
    if ((err as { code?: number })?.code === 404) throw new NotOwnNomineeError()
    throw err
  }
  if (nominee.userId !== userId) throw new NotOwnNomineeError()
  return nominee
}

export interface PortalEntry {
  nominee: NomineeDoc
  event: Pick<EventDoc, '$id' | 'title' | 'slug' | 'status'> | null
  category: Pick<CategoryDoc, '$id' | 'name'> | null
  organizationSlug: string | null
}

/** Everything the portal shows for one user: their nominee rows with event and category names. */
export async function portalEntries(userId: string): Promise<PortalEntry[]> {
  const nominees = await listOwnNominees(userId)
  if (nominees.length === 0) return []
  const { databases } = createAdminClient()
  const [events, categories, organizations] = await Promise.all([
    withRetry(() =>
      databases.listDocuments<EventDoc>(db(), APPWRITE.TABLES.EVENTS, [
        Query.equal('$id', [...new Set(nominees.map((n) => n.eventId))]),
        Query.limit(50),
      ])
    ),
    withRetry(() =>
      databases.listDocuments<CategoryDoc>(db(), APPWRITE.TABLES.CATEGORIES, [
        Query.equal('$id', [...new Set(nominees.map((n) => n.categoryId))]),
        Query.limit(50),
      ])
    ),
    withRetry(() =>
      databases.listDocuments<OrganizationDoc>(db(), APPWRITE.TABLES.ORGANIZATIONS, [
        Query.equal('$id', [...new Set(nominees.map((n) => n.organizationId))]),
        Query.limit(50),
      ])
    ),
  ])
  const eventById = new Map(events.documents.map((e) => [e.$id, e]))
  const categoryById = new Map(categories.documents.map((c) => [c.$id, c]))
  const orgById = new Map(organizations.documents.map((o) => [o.$id, o]))
  return nominees.map((nominee) => {
    const event = eventById.get(nominee.eventId)
    const category = categoryById.get(nominee.categoryId)
    return {
      nominee,
      event: event ? { $id: event.$id, title: event.title, slug: event.slug, status: event.status } : null,
      category: category ? { $id: category.$id, name: category.name } : null,
      organizationSlug: orgById.get(nominee.organizationId)?.slug ?? null,
    }
  })
}

export async function updateOwnProfile(
  userId: string,
  nomineeId: string,
  input: { name?: string; bio?: string }
): Promise<NomineeDoc> {
  const nominee = await requireOwnNominee(userId, nomineeId)
  const data: Partial<NomineeDoc> = {}
  if (input.name !== undefined) {
    const name = input.name.trim().replace(/\s+/g, ' ')
    if (name.length < 2) throw new ProfileError('nameTooShort')
    if (name.length > 120) throw new ProfileError('nameTooLong')
    data.name = name
  }
  if (input.bio !== undefined) {
    const bio = input.bio.trim() || null
    if (bio && bio.length > 2000) throw new ProfileError('bioTooLong')
    data.bio = bio
  }
  if (Object.keys(data).length === 0) return nominee
  const { databases } = createAdminClient()
  return withRetry(() => databases.updateDocument<NomineeDoc>(db(), APPWRITE.TABLES.NOMINEES, nominee.$id, data))
}

export function photoViewUrl(fileId: string): string {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? ''
  const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? ''
  return `${endpoint}/storage/buckets/${APPWRITE.BUCKETS.NOMINEE_PHOTOS}/files/${fileId}/view?project=${project}`
}

/**
 * Stores the nominee's photo: resized and re-encoded, publicly readable (it
 * goes on a flyer and a public page), and linked to the row. Completing the
 * profile is what triggers flyer generation once the engine exists.
 */
export async function attachPhoto(userId: string, nomineeId: string, input: Uint8Array): Promise<NomineeDoc> {
  const nominee = await requireOwnNominee(userId, nomineeId)
  const jpeg = await normalizePhoto(input)
  const { storage, databases } = createAdminClient()
  const { InputFile } = await import('node-appwrite/file')
  const file = await withRetry(() =>
    storage.createFile(
      APPWRITE.BUCKETS.NOMINEE_PHOTOS,
      ID.unique(),
      InputFile.fromBuffer(jpeg, `${nominee.code}.jpg`),
      [Permission.read(Role.any())]
    )
  )
  const updated = await withRetry(() =>
    databases.updateDocument<NomineeDoc>(db(), APPWRITE.TABLES.NOMINEES, nominee.$id, {
      photoUrl: photoViewUrl(file.$id),
      profileCompletedAt: nominee.profileCompletedAt ?? new Date().toISOString(),
    })
  )
  // Best effort: the replaced file is no longer referenced anywhere.
  const previous = photoFileId(nominee.photoUrl)
  if (previous && previous !== file.$id) {
    await storage.deleteFile(APPWRITE.BUCKETS.NOMINEE_PHOTOS, previous).catch(() => {})
  }
  return updated
}

/** The file id inside a URL made by `photoViewUrl`, or null. */
export function photoFileId(photoUrl: string | null): string | null {
  if (!photoUrl) return null
  const m = /\/buckets\/[^/]+\/files\/([^/?]+)\/view/.exec(photoUrl)
  return m ? m[1] : null
}
