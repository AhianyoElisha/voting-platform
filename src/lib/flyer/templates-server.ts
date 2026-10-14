import { ID, Permission, Query, Role } from 'node-appwrite'
import { createAdminClient, withRetry } from '../appwrite-server'
import { APPWRITE } from '../constants'
import {
  createTenantDocument,
  getTenantDocument,
  listTenantDocuments,
  updateTenantDocument,
  type TenantContext,
} from '../db'
import { assertCanDesign } from '../tenant'
import type { EventDoc, FlyerTemplateDoc, FontDoc, NomineeDoc } from '../types'
import { EMPTY_MODEL, validateModel, type SlotModel } from './model'

/**
 * Flyer templates (FLYER_ENGINE.md "Template setup"). Organization-owned,
 * one or more per event, optionally per category. The background image
 * defines the canvas size. Publishing bumps the version so generated flyers
 * know whether they are current.
 */
export type TemplateProblem =
  'nameTooShort' | 'nameTooLong' | 'invalidModel' | 'categoryNotInEvent' | 'noBackground' | 'badImage' | 'wrongEvent'

export class TemplateError extends Error {
  constructor(
    public readonly problem: TemplateProblem,
    public readonly details: string[] = []
  ) {
    super(`Template: ${problem}`)
    this.name = 'TemplateError'
  }
}

export const DEFAULT_WIDTH = 1080
export const DEFAULT_HEIGHT = 1920

export async function listTemplates(ctx: TenantContext, eventId: string): Promise<FlyerTemplateDoc[]> {
  const res = await listTenantDocuments<FlyerTemplateDoc>(ctx, APPWRITE.TABLES.FLYER_TEMPLATES, [
    Query.equal('eventId', [eventId]),
    Query.orderAsc('$createdAt'),
    Query.limit(50),
  ])
  return res.documents
}

/** With `expectedEventId`, a template from another event of the same workspace reads as not found. */
export async function getTemplate(
  ctx: TenantContext,
  templateId: string,
  expectedEventId?: string
): Promise<FlyerTemplateDoc> {
  const template = await getTenantDocument<FlyerTemplateDoc>(ctx, APPWRITE.TABLES.FLYER_TEMPLATES, templateId)
  if (expectedEventId && template.eventId !== expectedEventId) throw new TemplateError('wrongEvent')
  return template
}

export async function createTemplate(
  ctx: TenantContext,
  eventId: string,
  input: { name: string; categoryId?: string | null }
): Promise<FlyerTemplateDoc> {
  assertCanDesign(ctx)
  await getTenantDocument<EventDoc>(ctx, APPWRITE.TABLES.EVENTS, eventId)
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ')
  if (name.length < 2) throw new TemplateError('nameTooShort')
  if (name.length > 120) throw new TemplateError('nameTooLong')
  if (input.categoryId) {
    const category = await getTenantDocument<{ eventId: string } & FlyerTemplateDoc>(
      ctx,
      APPWRITE.TABLES.CATEGORIES,
      input.categoryId
    )
    if (category.eventId !== eventId) throw new TemplateError('categoryNotInEvent')
  }
  return createTenantDocument<FlyerTemplateDoc>(ctx, APPWRITE.TABLES.FLYER_TEMPLATES, {
    eventId,
    categoryId: input.categoryId || null,
    name,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    backgroundFileId: null,
    canvasJson: JSON.stringify(EMPTY_MODEL),
    status: 'draft',
    version: 0,
  })
}

export async function saveTemplateModel(
  ctx: TenantContext,
  templateId: string,
  model: unknown,
  name?: string
): Promise<FlyerTemplateDoc> {
  assertCanDesign(ctx)
  const template = await getTemplate(ctx, templateId)
  const problems = validateModel(model, template.width, template.height)
  if (problems.length) throw new TemplateError('invalidModel', problems)
  const data: Partial<FlyerTemplateDoc> = { canvasJson: JSON.stringify(model as SlotModel) }
  if (name !== undefined) {
    const clean = name.trim().replace(/\s+/g, ' ')
    if (clean.length < 2) throw new TemplateError('nameTooShort')
    if (clean.length > 120) throw new TemplateError('nameTooLong')
    data.name = clean
  }
  return updateTenantDocument<FlyerTemplateDoc>(ctx, APPWRITE.TABLES.FLYER_TEMPLATES, templateId, data)
}

/** Stores the background and makes it the canvas: the template takes the image's size. */
export async function setTemplateBackground(
  ctx: TenantContext,
  templateId: string,
  image: Uint8Array
): Promise<FlyerTemplateDoc> {
  assertCanDesign(ctx)
  const template = await getTemplate(ctx, templateId)
  const sharp = (await import('sharp')).default
  let width: number | undefined
  let height: number | undefined
  let png: Uint8Array
  try {
    const meta = await sharp(image).metadata()
    width = meta.width
    height = meta.height
    // Normalize to PNG, bounded so a 20 MP export does not become a 20 MP flyer.
    png = new Uint8Array(
      await sharp(image).rotate().resize(2160, 3840, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    )
    const normalized = await sharp(png).metadata()
    width = normalized.width
    height = normalized.height
  } catch {
    throw new TemplateError('badImage')
  }
  if (!width || !height) throw new TemplateError('badImage')

  const { storage } = createAdminClient()
  const { InputFile } = await import('node-appwrite/file')
  const file = await withRetry(() =>
    storage.createFile(APPWRITE.BUCKETS.FLYER_TEMPLATES, ID.unique(), InputFile.fromBuffer(png, `${templateId}.png`), [
      Permission.read(Role.any()),
    ])
  )
  const updated = await updateTenantDocument<FlyerTemplateDoc>(ctx, APPWRITE.TABLES.FLYER_TEMPLATES, templateId, {
    backgroundFileId: file.$id,
    width,
    height,
  })
  if (template.backgroundFileId && template.backgroundFileId !== file.$id) {
    await storage.deleteFile(APPWRITE.BUCKETS.FLYER_TEMPLATES, template.backgroundFileId).catch(() => {})
  }
  return updated
}

/** Publishing bumps the version; generated flyers from older versions are stale. */
export async function publishTemplate(ctx: TenantContext, templateId: string): Promise<FlyerTemplateDoc> {
  assertCanDesign(ctx)
  const template = await getTemplate(ctx, templateId)
  if (!template.backgroundFileId) throw new TemplateError('noBackground')
  const problems = validateModel(JSON.parse(template.canvasJson), template.width, template.height)
  if (problems.length) throw new TemplateError('invalidModel', problems)
  return updateTenantDocument<FlyerTemplateDoc>(ctx, APPWRITE.TABLES.FLYER_TEMPLATES, templateId, {
    status: 'published',
    version: template.version + 1,
  })
}

export async function unpublishTemplate(ctx: TenantContext, templateId: string): Promise<FlyerTemplateDoc> {
  assertCanDesign(ctx)
  await getTemplate(ctx, templateId)
  return updateTenantDocument<FlyerTemplateDoc>(ctx, APPWRITE.TABLES.FLYER_TEMPLATES, templateId, { status: 'draft' })
}

/**
 * The published template that applies to a nominee: the one for their
 * category if any, else the event-wide one. Null means "flyer coming soon".
 */
export async function resolveTemplateForNominee(
  nominee: Pick<NomineeDoc, 'organizationId' | 'eventId' | 'categoryId'>
): Promise<FlyerTemplateDoc | null> {
  const ctx: TenantContext = { organizationId: nominee.organizationId, userId: 'system', role: 'scanner' }
  const res = await listTenantDocuments<FlyerTemplateDoc>(ctx, APPWRITE.TABLES.FLYER_TEMPLATES, [
    Query.equal('eventId', [nominee.eventId]),
    Query.equal('status', ['published']),
    Query.limit(50),
  ])
  const forCategory = res.documents.find((t) => t.categoryId === nominee.categoryId)
  return forCategory ?? res.documents.find((t) => !t.categoryId) ?? null
}

export function fileViewUrl(bucket: string, fileId: string): string {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? ''
  const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? ''
  return `${endpoint}/storage/buckets/${bucket}/files/${fileId}/view?project=${project}`
}

// ─── Fonts ─────────────────────────────────────────────────────

export type FontProblem = 'familyInvalid' | 'badFontFile' | 'weightInvalid'

export class FontError extends Error {
  constructor(public readonly problem: FontProblem) {
    super(`Font: ${problem}`)
    this.name = 'FontError'
  }
}

/** TTF (00 01 00 00 or 'true'), OTF ('OTTO'). WOFF is rejected: the renderer wants raw outlines. */
export function sniffFontFormat(bytes: Uint8Array): 'ttf' | 'otf' | null {
  if (bytes.length < 4) return null
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (tag === 'OTTO') return 'otf'
  if (tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return 'ttf'
  return null
}

/** Platform fonts (organizationId null) plus the organization's own. */
export async function listFonts(organizationId: string): Promise<FontDoc[]> {
  const { databases } = createAdminClient()
  const [platform, own] = await Promise.all([
    withRetry(() =>
      databases.listDocuments<FontDoc>(process.env.APPWRITE_DATABASE_ID as string, APPWRITE.TABLES.FONTS, [
        Query.isNull('organizationId'),
        Query.limit(100),
      ])
    ),
    withRetry(() =>
      databases.listDocuments<FontDoc>(process.env.APPWRITE_DATABASE_ID as string, APPWRITE.TABLES.FONTS, [
        Query.equal('organizationId', [organizationId]),
        Query.limit(100),
      ])
    ),
  ])
  return [...platform.documents, ...own.documents]
}

export async function uploadFont(
  ctx: TenantContext,
  input: { family: string; weight: number; style: 'normal' | 'italic'; bytes: Uint8Array }
): Promise<FontDoc> {
  assertCanDesign(ctx)
  const family = (input.family ?? '').trim().replace(/\s+/g, ' ')
  if (family.length < 1 || family.length > 80 || /["\\]/.test(family)) throw new FontError('familyInvalid')
  if (!Number.isInteger(input.weight) || input.weight < 100 || input.weight > 900) throw new FontError('weightInvalid')
  const format = sniffFontFormat(input.bytes)
  if (!format) throw new FontError('badFontFile')
  const { storage, databases } = createAdminClient()
  const { InputFile } = await import('node-appwrite/file')
  const file = await withRetry(() =>
    storage.createFile(
      APPWRITE.BUCKETS.FONTS,
      ID.unique(),
      InputFile.fromBuffer(input.bytes, `${family.replace(/[^a-z0-9]+/gi, '-')}.${format}`),
      [Permission.read(Role.any())]
    )
  )
  return withRetry(() =>
    databases.createDocument<FontDoc>(process.env.APPWRITE_DATABASE_ID as string, APPWRITE.TABLES.FONTS, ID.unique(), {
      organizationId: ctx.organizationId,
      family,
      fileId: file.$id,
      weight: input.weight,
      style: input.style === 'italic' ? 'italic' : 'normal',
    })
  )
}
