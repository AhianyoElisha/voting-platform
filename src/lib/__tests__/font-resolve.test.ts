import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
const storage = { createFile: vi.fn() }
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake, storage }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))
vi.mock('node-appwrite/file', () => ({ InputFile: { fromBuffer: (b: Uint8Array, name: string) => ({ b, name }) } }))

import type { TenantContext } from '../db'
import { resolveFonts } from '../flyer/font-resolve-server'
import {
  closestVariant,
  parseFamilyMetadata,
  platformFontId,
  resetGoogleFontsCache,
  ttfUrlFromCss,
} from '../flyer/google-fonts'
import { ForbiddenError } from '../tenant'

const designer: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'designer' }
const METADATA =
  ")]}'\n" +
  JSON.stringify({
    familyMetadataList: [
      { family: 'Montserrat', fonts: { '400': {}, '700': {}, '900': {}, '400i': {} } },
      { family: 'Playfair Display', fonts: { '400': {}, '900': {}, '900i': {} } },
    ],
  })
const TTF = new Uint8Array([0, 1, 0, 0, 9, 9, 9])
const fetchMock = vi.fn()

function respond(url: string): Response {
  if (url.startsWith('https://fonts.google.com/metadata/fonts')) return new Response(METADATA)
  if (url.startsWith('https://fonts.googleapis.com/css2')) {
    return new Response(`@font-face { src: url(https://fonts.gstatic.com/s/x/v1/abc.ttf) format('truetype'); }`)
  }
  if (url.startsWith('https://fonts.gstatic.com/')) return new Response(TTF)
  return new Response('nope', { status: 404 })
}

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  fake = createFakeDatabases({ ...UNIQUE_INDEXES })
  storage.createFile.mockReset().mockResolvedValue({})
  resetGoogleFontsCache()
  fetchMock.mockReset().mockImplementation(async (url: string) => respond(url))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('Google Fonts helpers', () => {
  it('parses the family list behind its prefix', () => {
    const map = parseFamilyMetadata(METADATA)
    expect(map.get('playfairdisplay')?.family).toBe('Playfair Display')
    expect([...map.get('montserrat')!.variants]).toContain('400i')
  })

  it('picks the closest weight, preferring the wanted style', () => {
    const pf = parseFamilyMetadata(METADATA).get('playfairdisplay')!
    expect(closestVariant(pf, 900, true)).toEqual({ weight: 900, italic: true })
    expect(closestVariant(pf, 700, false)).toEqual({ weight: 900, italic: false })
    expect(closestVariant(pf, 400, true)).toEqual({ weight: 900, italic: true })
  })

  it('only accepts TTF links on Google font host', () => {
    expect(ttfUrlFromCss('src: url(https://fonts.gstatic.com/s/a.ttf)')).toBe('https://fonts.gstatic.com/s/a.ttf')
    expect(ttfUrlFromCss('src: url(https://evil.example/s/a.ttf)')).toBeNull()
    expect(ttfUrlFromCss('src: url(https://fonts.gstatic.com/s/a.woff2)')).toBeNull()
  })
})

describe('resolveFonts', () => {
  it('fetches a Google font once into the platform library, shared by every organization', async () => {
    const [first] = await resolveFonts(designer, ['Montserrat-Bold'])
    expect(first).toEqual({
      postScriptName: 'Montserrat-Bold',
      family: 'Montserrat',
      weight: 700,
      italic: false,
      status: 'fetched',
    })
    const id = platformFontId('Montserrat', 700, false)
    const row = await fake.getDocument('voteapp', 'fonts', id)
    expect(row).toMatchObject({ organizationId: null, family: 'Montserrat', weight: 700, style: 'normal', fileId: id })
    expect(storage.createFile).toHaveBeenCalledTimes(1)
    // Same organization or another one: now simply available, no second download.
    fetchMock.mockClear()
    const other: TenantContext = { organizationId: 'org2', userId: 'u9', role: 'owner' }
    expect((await resolveFonts(other, ['Montserrat-Bold']))[0].status).toBe('available')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the closest variant and says so', async () => {
    const [r] = await resolveFonts(designer, ['PlayfairDisplay-Bold'])
    expect(r).toMatchObject({
      family: 'Playfair Display',
      weight: 900,
      italic: false,
      status: 'fetched',
      substituted: true,
    })
  })

  it('knows the built-in Poppins and the organization’s own uploads', async () => {
    fake.seed('fonts', {
      $id: 'f1',
      organizationId: 'org1',
      family: 'Brand Sans',
      fileId: 'x',
      weight: 700,
      style: 'normal',
    })
    const res = await resolveFonts(designer, ['Poppins-SemiBold', 'BrandSans-Bold'])
    expect(res.map((r) => [r.family, r.status])).toEqual([
      ['Poppins', 'available'],
      ['Brand Sans', 'available'],
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks for an upload when Google does not have the font', async () => {
    const [r] = await resolveFonts(designer, ['Arial-BoldMT'])
    expect(r).toEqual({
      postScriptName: 'Arial-BoldMT',
      family: 'Arial MT',
      weight: 700,
      italic: false,
      status: 'upload',
    })
  })

  it('another organization’s private upload does not count', async () => {
    fake.seed('fonts', {
      $id: 'f2',
      organizationId: 'org2',
      family: 'Brand Sans',
      fileId: 'x',
      weight: 700,
      style: 'normal',
    })
    expect((await resolveFonts(designer, ['BrandSans-Bold']))[0].status).toBe('upload')
  })

  it('falls back to upload, flagged, when Google cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const [r] = await resolveFonts(designer, ['Montserrat-Bold'])
    expect(r).toMatchObject({ status: 'upload', googleUnavailable: true })
  })

  it('is for designers and above', async () => {
    await expect(resolveFonts({ ...designer, role: 'staff' }, ['Montserrat-Bold'])).rejects.toBeInstanceOf(
      ForbiddenError
    )
  })

  it('dedupes names and ignores empty ones', async () => {
    const res = await resolveFonts(designer, ['Poppins-Bold', 'Poppins-Bold', ' ', ''])
    expect(res).toHaveLength(1)
  })
})
