import { beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
const files = new Map<string, Uint8Array>()
let fileSeq = 0
const storage = {
  createFile: vi.fn(async (_bucket: string, _id: string, file: { b: Uint8Array }) => {
    const $id = `file_${++fileSeq}`
    files.set($id, file.b)
    return { $id }
  }),
  deleteFile: vi.fn(async (_bucket: string, id: string) => {
    files.delete(id)
  }),
  getFileDownload: vi.fn(async (_bucket: string, id: string) => {
    const b = files.get(id)
    if (!b) throw Object.assign(new Error('missing'), { code: 404 })
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  }),
}
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake, storage }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))
vi.mock('node-appwrite/file', () => ({ InputFile: { fromBuffer: (b: Uint8Array, name: string) => ({ b, name }) } }))

import { TenantMismatchError, type TenantContext } from '../db'
import { createEvent } from '../events-server'
import { ensureFlyer, flyerForNominee, flyersForEvent, generateForEvent, sourceHash } from '../flyer/generate-server'
import { newPhotoSlot, newTextSlot } from '../flyer/model'
import { solidPng } from '../flyer/render'
import {
  FontError,
  TemplateError,
  createTemplate,
  getTemplate,
  publishTemplate,
  resolveTemplateForNominee,
  saveTemplateModel,
  setTemplateBackground,
  setTemplateLayer,
  sniffFontFormat,
  uploadFont,
} from '../flyer/templates-server'
import { createCategory, createNominee } from '../nominees-server'
import { ForbiddenError } from '../tenant'

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const designer: TenantContext = { organizationId: 'org1', userId: 'u5', role: 'designer' }
const staff: TenantContext = { organizationId: 'org1', userId: 'u2', role: 'staff' }
const otherOrg: TenantContext = { organizationId: 'org2', userId: 'u3', role: 'owner' }

async function seed() {
  const { event } = await createEvent(owner, {
    title: 'Faculty Awards',
    votePriceCedis: '1',
    startsAt: '2026-11-01T00:00:00Z',
    endsAt: '2026-11-30T00:00:00Z',
    resultsVisibility: 'hidden',
  })
  const category = await createCategory(owner, event.$id, 'Most Influential')
  const { nominee } = await createNominee(owner, { eventId: event.$id, categoryId: category.$id, name: 'Ama Owusu' })
  return { event, category, nominee }
}

async function withPhoto(nomineeId: string) {
  const id = `file_${++fileSeq}`
  files.set(id, solidPng(40, 60, '#00ff00'))
  await fake.updateDocument('voteapp', 'nominees', nomineeId, {
    photoUrl: `https://fra.cloud.appwrite.io/v1/storage/buckets/nominee-photos/files/${id}/view?project=p`,
  })
  return id
}

async function publishedTemplate(eventId: string, categoryId: string | null = null) {
  const t = await createTemplate(designer, eventId, { name: 'Main flyer', categoryId })
  await setTemplateBackground(designer, t.$id, solidPng(120, 200, '#0000ff'))
  await saveTemplateModel(designer, t.$id, {
    version: 1,
    slots: [
      { ...newPhotoSlot(120, 200), id: 'p', x: 10, y: 10, w: 60, h: 60 },
      { ...newTextSlot(120, 200, 'nominee.name'), id: 't', x: 0, y: 150, w: 120, h: 30, fontSize: 14, minFontSize: 8 },
    ],
  })
  return publishTemplate(designer, t.$id)
}

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  fake = createFakeDatabases(UNIQUE_INDEXES)
  fake.seed('organizations', {
    $id: 'org1',
    name: 'Org 1',
    slug: 'org-1',
    status: 'active',
    moraleCandidatesEnabled: false,
  })
  files.clear()
  fileSeq = 0
  storage.createFile.mockClear()
  storage.deleteFile.mockClear()
})

describe('templates', () => {
  test('designers and managers create; staff and other tenants cannot', async () => {
    const { event } = await seed()
    const t = await createTemplate(designer, event.$id, { name: 'Main' })
    expect(t).toMatchObject({ organizationId: 'org1', status: 'draft', version: 0, width: 1080, height: 1920 })
    await expect(createTemplate(staff, event.$id, { name: 'X' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createTemplate(otherOrg, event.$id, { name: 'X' })).rejects.toBeInstanceOf(TenantMismatchError)
    await expect(saveTemplateModel(otherOrg, t.$id, { version: 1, slots: [] })).rejects.toBeInstanceOf(
      TenantMismatchError
    )
  })

  test('a template read through another event of the same workspace is not found', async () => {
    const { event } = await seed()
    const other = await createEvent(owner, {
      title: 'Other Event',
      votePriceCedis: '1',
      startsAt: '2026-11-01T00:00:00Z',
      endsAt: '2026-11-30T00:00:00Z',
      resultsVisibility: 'hidden',
    })
    const t = await createTemplate(designer, event.$id, { name: 'Main' })
    await expect(getTemplate(designer, t.$id, event.$id)).resolves.toMatchObject({ $id: t.$id })
    await expect(getTemplate(designer, t.$id, other.event.$id)).rejects.toThrow(/wrongEvent/)
  })

  test('the background sets the canvas size and replaces the old file', async () => {
    const { event } = await seed()
    const t = await createTemplate(designer, event.$id, { name: 'Main' })
    const a = await setTemplateBackground(designer, t.$id, solidPng(300, 500, '#0000ff'))
    expect([a.width, a.height]).toEqual([300, 500])
    const b = await setTemplateBackground(designer, t.$id, solidPng(100, 100, '#ff0000'))
    expect([b.width, b.height]).toEqual([100, 100])
    expect(storage.deleteFile).toHaveBeenCalledWith('flyer-templates', a.backgroundFileId)
    await expect(setTemplateBackground(designer, t.$id, new Uint8Array([1, 2, 3]))).rejects.toThrow(/badImage/)
  })

  test('foreground and photo mask: stored, replaced, cleared, and dropped by a new background', async () => {
    const { event } = await seed()
    const t = await createTemplate(designer, event.$id, { name: 'Main' })
    await setTemplateBackground(designer, t.$id, solidPng(300, 500, '#0000ff'))
    const a = await setTemplateLayer(designer, t.$id, 'foreground', solidPng(600, 1000, '#ff0000'))
    expect(a.foregroundFileId).toBeTruthy()
    const m = await setTemplateLayer(designer, t.$id, 'photoMask', solidPng(50, 50, '#ffffff'))
    expect(m.photoMaskFileId).toBeTruthy()
    const b = await setTemplateLayer(designer, t.$id, 'foreground', solidPng(300, 500, '#00ff00'))
    expect(storage.deleteFile).toHaveBeenCalledWith('flyer-templates', a.foregroundFileId)
    const cleared = await setTemplateLayer(designer, t.$id, 'foreground', null)
    expect(cleared.foregroundFileId).toBeNull()
    expect(storage.deleteFile).toHaveBeenCalledWith('flyer-templates', b.foregroundFileId)
    const fresh = await setTemplateBackground(designer, t.$id, solidPng(100, 100, '#0000ff'))
    expect(fresh.photoMaskFileId).toBeNull()
    expect(storage.deleteFile).toHaveBeenCalledWith('flyer-templates', m.photoMaskFileId)
    await expect(setTemplateLayer(designer, t.$id, 'photoMask', new Uint8Array([1, 2]))).rejects.toThrow(/badImage/)
    await expect(setTemplateLayer({ ...designer, role: 'staff' }, t.$id, 'foreground', null)).rejects.toBeInstanceOf(
      ForbiddenError
    )
  })

  test('invalid models are refused with details; publishing needs a background and bumps the version', async () => {
    const { event } = await seed()
    const t = await createTemplate(designer, event.$id, { name: 'Main' })
    await expect(saveTemplateModel(designer, t.$id, { version: 1, slots: [{ type: 'text' }] })).rejects.toBeInstanceOf(
      TemplateError
    )
    await expect(publishTemplate(designer, t.$id)).rejects.toThrow(/noBackground/)
    await setTemplateBackground(designer, t.$id, solidPng(100, 100, '#0000ff'))
    const p1 = await publishTemplate(designer, t.$id)
    expect(p1).toMatchObject({ status: 'published', version: 1 })
    const p2 = await publishTemplate(designer, t.$id)
    expect(p2.version).toBe(2)
  })

  test('category templates override the event template', async () => {
    const { event, category, nominee } = await seed()
    const eventWide = await publishedTemplate(event.$id)
    expect((await resolveTemplateForNominee(nominee))?.$id).toBe(eventWide.$id)
    const forCategory = await publishedTemplate(event.$id, category.$id)
    expect((await resolveTemplateForNominee(nominee))?.$id).toBe(forCategory.$id)
    const other = await createCategory(owner, event.$id, 'Other')
    const { nominee: n2 } = await createNominee(owner, { eventId: event.$id, categoryId: other.$id, name: 'Kofi' })
    expect((await resolveTemplateForNominee(n2))?.$id).toBe(eventWide.$id)
  })
})

describe('fonts', () => {
  test('sniffs TTF and OTF and rejects anything else', () => {
    expect(sniffFontFormat(new Uint8Array([0, 1, 0, 0, 9]))).toBe('ttf')
    expect(sniffFontFormat(new TextEncoder().encode('true....'))).toBe('ttf')
    expect(sniffFontFormat(new TextEncoder().encode('OTTO....'))).toBe('otf')
    expect(sniffFontFormat(new TextEncoder().encode('wOFF....'))).toBeNull()
    expect(sniffFontFormat(new Uint8Array([1]))).toBeNull()
  })

  test('uploads validate family, weight and file, and are scoped to the organization', async () => {
    const ttf = new Uint8Array([0, 1, 0, 0, 1, 2, 3])
    const font = await uploadFont(designer, { family: 'Bebas Neue', weight: 700, style: 'normal', bytes: ttf })
    expect(font).toMatchObject({ organizationId: 'org1', family: 'Bebas Neue', weight: 700 })
    await expect(uploadFont(designer, { family: '', weight: 400, style: 'normal', bytes: ttf })).rejects.toBeInstanceOf(
      FontError
    )
    await expect(uploadFont(designer, { family: 'X', weight: 50, style: 'normal', bytes: ttf })).rejects.toThrow(
      /weightInvalid/
    )
    await expect(
      uploadFont(designer, { family: 'X', weight: 400, style: 'normal', bytes: new TextEncoder().encode('wOFF..') })
    ).rejects.toThrow(/badFontFile/)
    await expect(uploadFont(staff, { family: 'X', weight: 400, style: 'normal', bytes: ttf })).rejects.toBeInstanceOf(
      ForbiddenError
    )
  })
})

describe('ensureFlyer', () => {
  test('nothing without a template or a photo; generates once; regenerates only when inputs change', async () => {
    const { event, nominee } = await seed()
    expect((await ensureFlyer(nominee.$id)).outcome).toBe('noTemplate')
    await publishedTemplate(event.$id)
    expect((await ensureFlyer(nominee.$id)).outcome).toBe('noPhoto')
    await withPhoto(nominee.$id)

    const first = await ensureFlyer(nominee.$id)
    expect(first.outcome).toBe('generated')
    expect(first.flyer).toMatchObject({ nomineeId: nominee.$id, organizationId: 'org1', templateVersion: 1 })
    expect(files.get(first.flyer!.fileId)!.length).toBeGreaterThan(100)
    const renders = storage.createFile.mock.calls.length

    expect((await ensureFlyer(nominee.$id)).outcome).toBe('current')
    expect(storage.createFile.mock.calls.length).toBe(renders)

    // A name change regenerates and the old file goes away.
    await fake.updateDocument('voteapp', 'nominees', nominee.$id, { name: 'Ama Serwaa' })
    const second = await ensureFlyer(nominee.$id)
    expect(second.outcome).toBe('generated')
    expect(second.flyer!.fileId).not.toBe(first.flyer!.fileId)
    expect(storage.deleteFile).toHaveBeenCalledWith('flyers', first.flyer!.fileId)
    expect((await flyerForNominee(nominee.$id))?.fileId).toBe(second.flyer!.fileId)
    expect(fake.dump('generated_flyers')).toHaveLength(1)
  })

  test('moving the photo re-renders with that focus; a centred photo keeps its hash', async () => {
    const { event, nominee } = await seed()
    await publishedTemplate(event.$id)
    await withPhoto(nominee.$id)
    const seen: unknown[] = []
    const render = async (inputs: { photoFocus?: unknown }) => {
      seen.push(inputs.photoFocus)
      return new Uint8Array(200)
    }
    expect((await ensureFlyer(nominee.$id, { render })).outcome).toBe('generated')
    // Explicit nulls (centre) are the same flyer as a row without the columns.
    await fake.updateDocument('voteapp', 'nominees', nominee.$id, { photoFocusX: null, photoFocusY: null })
    expect((await ensureFlyer(nominee.$id, { render })).outcome).toBe('current')

    await fake.updateDocument('voteapp', 'nominees', nominee.$id, { photoFocusX: 50, photoFocusY: 15 })
    expect((await ensureFlyer(nominee.$id, { render })).outcome).toBe('generated')
    expect((await ensureFlyer(nominee.$id, { render })).outcome).toBe('current')
    // Zooming alone re-renders too.
    await fake.updateDocument('voteapp', 'nominees', nominee.$id, { photoZoom: 180 })
    expect((await ensureFlyer(nominee.$id, { render })).outcome).toBe('generated')
    expect((await ensureFlyer(nominee.$id, { render })).outcome).toBe('current')
    expect(seen).toEqual([
      { x: 50, y: 50, zoom: 100 },
      { x: 50, y: 15, zoom: 100 },
      { x: 50, y: 15, zoom: 180 },
    ])
  })

  test('a republished template invalidates every flyer', async () => {
    const { event, nominee } = await seed()
    const t = await publishedTemplate(event.$id)
    await withPhoto(nominee.$id)
    const first = await ensureFlyer(nominee.$id)
    await publishTemplate(designer, t.$id)
    const second = await ensureFlyer(nominee.$id)
    expect(second.outcome).toBe('generated')
    expect(second.flyer!.templateVersion).toBe(2)
    expect(second.flyer!.fileId).not.toBe(first.flyer!.fileId)
  })
  test('a flyer made by an older renderer is re-rendered (the renderer version is in the hash)', async () => {
    delete process.env.USSD_SHORTCODE
    const { event, nominee } = await seed()
    const t = await publishedTemplate(event.$id)
    const photoId = await withPhoto(nominee.$id)
    const first = await ensureFlyer(nominee.$id)
    // The hash an older renderer stored: same inputs, no renderer version.
    const legacy = sourceHash({
      templateId: t.$id,
      version: t.version,
      photoId,
      nomineeName: nominee.name,
      nomineeCode: nominee.code,
      categoryName: 'Most Influential',
      eventTitle: event.title,
      ussdShortcode: null,
    })
    expect(first.flyer!.sourceHash).not.toBe(legacy)
    await fake.updateDocument('voteapp', 'generated_flyers', first.flyer!.$id, { sourceHash: legacy })
    expect((await ensureFlyer(nominee.$id)).outcome).toBe('generated')
    expect((await ensureFlyer(nominee.$id)).outcome).toBe('current')
  })
})

describe('generateForEvent', () => {
  test('walks nominees in batches and reports what happened', async () => {
    const { event, category, nominee } = await seed()
    await publishedTemplate(event.$id)
    await withPhoto(nominee.$id)
    const { nominee: n2 } = await createNominee(owner, { eventId: event.$id, categoryId: category.$id, name: 'Kofi' })
    await withPhoto(n2.$id)
    await createNominee(owner, { eventId: event.$id, categoryId: category.$id, name: 'No Photo' })

    const b1 = await generateForEvent(owner, event.$id, { limit: 2 })
    expect(b1).toMatchObject({ total: 3, processed: 2, generated: 2, nextOffset: 2 })
    const b2 = await generateForEvent(owner, event.$id, { offset: 2, limit: 2 })
    expect(b2).toMatchObject({ processed: 1, noPhoto: 1, nextOffset: null })
    const again = await generateForEvent(owner, event.$id, { limit: 10 })
    expect(again).toMatchObject({ generated: 0, current: 2, noPhoto: 1 })
    await expect(generateForEvent(otherOrg, event.$id)).resolves.toMatchObject({ total: 0 })

    // The event's flyer list contains only this event's flyers.
    const other = await createEvent(owner, {
      title: 'Other Event',
      votePriceCedis: '1',
      startsAt: '2026-11-01T00:00:00Z',
      endsAt: '2026-11-30T00:00:00Z',
      resultsVisibility: 'hidden',
    })
    const oc = await createCategory(owner, other.event.$id, 'Other Category')
    const { nominee: on } = await createNominee(owner, {
      eventId: other.event.$id,
      categoryId: oc.$id,
      name: 'Elsewhere',
    })
    await publishedTemplate(other.event.$id)
    await withPhoto(on.$id)
    await ensureFlyer(on.$id)
    expect((await flyersForEvent(owner, event.$id)).map((r) => r.nominee.name).sort()).toEqual(['Ama Owusu', 'Kofi'])
    expect((await flyersForEvent(owner, other.event.$id)).map((r) => r.nominee.name)).toEqual(['Elsewhere'])
    expect(await flyersForEvent(otherOrg, event.$id)).toEqual([])
  })
})
