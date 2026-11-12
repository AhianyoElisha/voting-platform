import crypto from 'crypto'
import fs from 'fs/promises'
import { ID, Permission, Query, Role } from 'node-appwrite'
import os from 'os'
import path from 'path'
import { createAdminClient, withRetry } from '../appwrite-server'
import { APPWRITE } from '../constants'
import { databaseId, listTenantDocuments, type TenantContext } from '../db'
import { focusOf, isCentred } from '../photo-focus'
import { photoFileId } from '../portal-server'
import type { CategoryDoc, EventDoc, FlyerTemplateDoc, FontDoc, GeneratedFlyerDoc, NomineeDoc } from '../types'
import type { BindingContext } from './bindings'
import { parseModel } from './model'
import { RENDERER_VERSION, renderFlyer, type FontFile, type RenderInputs } from './render'
import { fileViewUrl, listFonts, resolveTemplateForNominee } from './templates-server'

/**
 * Flyer generation (FLYER_ENGINE.md "Generation"). `ensureFlyer` is the one
 * entry point: it renders a nominee's flyer when the inputs changed since the
 * last one, and otherwise does nothing. Callers run it after a photo upload,
 * a profile change or a template publish, through `after()` so no request
 * waits on a render; `generateForEvent` walks an event in batches.
 */
const db = () => databaseId()

export type Renderer = (inputs: RenderInputs) => Promise<Uint8Array>

export function flyerUrl(fileId: string): string {
  return fileViewUrl(APPWRITE.BUCKETS.FLYERS, fileId)
}

export function sourceHash(parts: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export async function flyerForNominee(nomineeId: string): Promise<GeneratedFlyerDoc | null> {
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<GeneratedFlyerDoc>(db(), APPWRITE.TABLES.GENERATED_FLYERS, [
      Query.equal('nomineeId', [nomineeId]),
      Query.limit(1),
    ])
  )
  return res.documents[0] ?? null
}

async function download(bucket: string, fileId: string): Promise<Uint8Array> {
  const { storage } = createAdminClient()
  const buf = await withRetry(() => storage.getFileDownload(bucket, fileId))
  return new Uint8Array(buf)
}

/** Font files the model uses, fetched once per process into the temp dir. */
async function fontFilesFor(model: ReturnType<typeof parseModel>, organizationId: string): Promise<FontFile[]> {
  const families = new Set(model.slots.flatMap((s) => (s.type === 'text' ? [s.fontFamily] : [])))
  if (families.size === 0) return []
  const fonts = (await listFonts(organizationId)).filter((f) => families.has(f.family))
  const dir = path.join(os.tmpdir(), 'voteapp-fonts')
  await fs.mkdir(dir, { recursive: true })
  const files: FontFile[] = []
  for (const font of fonts) {
    const file = path.join(dir, `${font.fileId}.bin`)
    try {
      await fs.access(file)
    } catch {
      await fs.writeFile(file, await download(APPWRITE.BUCKETS.FONTS, font.fileId))
    }
    files.push({ family: font.family, path: file })
  }
  return files
}

export interface EnsureResult {
  outcome: 'generated' | 'current' | 'noTemplate' | 'noPhoto'
  flyer: GeneratedFlyerDoc | null
}

export async function ensureFlyer(
  nomineeId: string,
  opts: { force?: boolean; render?: Renderer } = {}
): Promise<EnsureResult> {
  const { databases, storage } = createAdminClient()
  const nominee = await withRetry(() => databases.getDocument<NomineeDoc>(db(), APPWRITE.TABLES.NOMINEES, nomineeId))
  const template = await resolveTemplateForNominee(nominee)
  const existing = await flyerForNominee(nomineeId)
  if (!template) return { outcome: 'noTemplate', flyer: existing }
  const photoId = photoFileId(nominee.photoUrl)
  if (!photoId) return { outcome: 'noPhoto', flyer: existing }

  const ctx: TenantContext = { organizationId: nominee.organizationId, userId: 'system', role: 'scanner' }
  const [event, categories] = await Promise.all([
    withRetry(() => databases.getDocument<EventDoc>(db(), APPWRITE.TABLES.EVENTS, nominee.eventId)),
    listTenantDocuments<CategoryDoc>(ctx, APPWRITE.TABLES.CATEGORIES, [
      Query.equal('$id', [nominee.categoryId]),
      Query.limit(1),
    ]),
  ])
  const context: BindingContext = {
    nomineeName: nominee.name,
    nomineeCode: nominee.code,
    categoryName: categories.documents[0]?.name ?? '',
    eventTitle: event.title,
    ussdShortcode: process.env.USSD_SHORTCODE ?? null,
  }
  const focus = focusOf(nominee)
  const hash = sourceHash({
    renderer: RENDERER_VERSION,
    templateId: template.$id,
    version: template.version,
    photoId,
    // Only when present, so flyers of templates without them keep their hashes.
    ...(template.foregroundFileId ? { foregroundFileId: template.foregroundFileId } : {}),
    ...(template.photoMaskFileId ? { photoMaskFileId: template.photoMaskFileId } : {}),
    ...(isCentred(focus) ? {} : { photoFocus: focus }),
    ...context,
  })
  if (!opts.force && existing && existing.sourceHash === hash && existing.templateId === template.$id) {
    return { outcome: 'current', flyer: existing }
  }

  const model = parseModel(template.canvasJson, template.width, template.height)
  const layer = (id: string | null | undefined) =>
    id ? download(APPWRITE.BUCKETS.FLYER_TEMPLATES, id) : Promise.resolve(null)
  const [background, foreground, photoMask, photo, fonts] = await Promise.all([
    layer(template.backgroundFileId),
    layer(template.foregroundFileId),
    layer(template.photoMaskFileId),
    download(APPWRITE.BUCKETS.NOMINEE_PHOTOS, photoId),
    fontFilesFor(model, nominee.organizationId),
  ])
  const render = opts.render ?? renderFlyer
  const png = await render({
    width: template.width,
    height: template.height,
    background,
    foreground,
    photoMask,
    photo,
    photoFocus: focus,
    model,
    context,
    fonts,
  })

  const { InputFile } = await import('node-appwrite/file')
  const file = await withRetry(() =>
    storage.createFile(APPWRITE.BUCKETS.FLYERS, ID.unique(), InputFile.fromBuffer(png, `${nominee.code}-flyer.png`), [
      Permission.read(Role.any()),
    ])
  )
  const data = {
    organizationId: nominee.organizationId,
    nomineeId,
    templateId: template.$id,
    templateVersion: template.version,
    fileId: file.$id,
    sourceHash: hash,
  }
  const flyer = existing
    ? await withRetry(() =>
        databases.updateDocument<GeneratedFlyerDoc>(db(), APPWRITE.TABLES.GENERATED_FLYERS, existing.$id, data)
      )
    : await withRetry(() =>
        databases.createDocument<GeneratedFlyerDoc>(db(), APPWRITE.TABLES.GENERATED_FLYERS, ID.unique(), data)
      )
  if (existing && existing.fileId !== file.$id) {
    await storage.deleteFile(APPWRITE.BUCKETS.FLYERS, existing.fileId).catch(() => {})
  }
  return { outcome: 'generated', flyer }
}

export interface BatchResult {
  total: number
  processed: number
  generated: number
  current: number
  noPhoto: number
  noTemplate: number
  nextOffset: number | null
}

/** Walks the event's nominees in batches so a request never renders more than `limit` flyers. */
export async function generateForEvent(
  ctx: TenantContext,
  eventId: string,
  opts: { offset?: number; limit?: number; force?: boolean; render?: Renderer } = {}
): Promise<BatchResult> {
  const offset = opts.offset ?? 0
  const limit = opts.limit ?? 10
  const nominees = await listTenantDocuments<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, [
    Query.equal('eventId', [eventId]),
    Query.equal('status', ['active']),
    Query.orderAsc('$createdAt'),
    Query.limit(500),
  ])
  const batch = nominees.documents.slice(offset, offset + limit)
  const result: BatchResult = {
    total: nominees.documents.length,
    processed: 0,
    generated: 0,
    current: 0,
    noPhoto: 0,
    noTemplate: 0,
    nextOffset: null,
  }
  for (const nominee of batch) {
    result.processed += 1
    try {
      const { outcome } = await ensureFlyer(nominee.$id, { force: opts.force, render: opts.render })
      if (outcome === 'generated') result.generated += 1
      else if (outcome === 'current') result.current += 1
      else if (outcome === 'noPhoto') result.noPhoto += 1
      else result.noTemplate += 1
    } catch (err) {
      console.error(`[flyer] ${nominee.$id}:`, err)
    }
  }
  if (offset + limit < nominees.documents.length) result.nextOffset = offset + limit
  return result
}

/** Generated flyers for an event, with their nominees, for the organizer's list and the ZIP. */
export async function flyersForEvent(
  ctx: TenantContext,
  eventId: string
): Promise<{ flyer: GeneratedFlyerDoc; nominee: NomineeDoc }[]> {
  const templates = await listTenantDocuments<FlyerTemplateDoc>(ctx, APPWRITE.TABLES.FLYER_TEMPLATES, [
    Query.equal('eventId', [eventId]),
    Query.limit(50),
  ])
  if (templates.documents.length === 0) return []
  const [flyers, nominees] = await Promise.all([
    listTenantDocuments<GeneratedFlyerDoc>(ctx, APPWRITE.TABLES.GENERATED_FLYERS, [
      Query.equal(
        'templateId',
        templates.documents.map((t) => t.$id)
      ),
      Query.limit(500),
    ]),
    listTenantDocuments<NomineeDoc>(ctx, APPWRITE.TABLES.NOMINEES, [
      Query.equal('eventId', [eventId]),
      Query.limit(500),
    ]),
  ])
  const byId = new Map(nominees.documents.map((n) => [n.$id, n]))
  return flyers.documents.flatMap((flyer) => {
    const nominee = byId.get(flyer.nomineeId)
    return nominee ? [{ flyer, nominee }] : []
  })
}

export async function downloadFlyer(fileId: string): Promise<Uint8Array> {
  return download(APPWRITE.BUCKETS.FLYERS, fileId)
}

export type { FlyerTemplateDoc, FontDoc }
