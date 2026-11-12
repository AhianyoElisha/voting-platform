import { Permission, Role } from 'node-appwrite'
import { createHash } from 'node:crypto'
import { createAdminClient, withRetry } from '../appwrite-server'
import { APPWRITE } from '../constants'
import { databaseId } from '../db'
import type { FontDoc } from '../types'
import { familyKey } from './font-names'

/**
 * Google Fonts as the platform font library (decided 2026-11-12). Every
 * family there is under an open licence (SIL OFL, Apache 2.0 or the Ubuntu
 * Font Licence) that allows redistribution, so a font fetched for one
 * organization is stored once as a platform font (`organizationId` null)
 * and every organization can use it. Fonts that are not on Google Fonts are
 * uploaded by the organization that holds a licence and stay private to it.
 *
 * Two public endpoints, no API key:
 * - the family list (`fonts.google.com/metadata/fonts`, the JSON the Google
 *   Fonts site itself uses; cached for a day), to map a PSD's PostScript
 *   name to a family and see which weights exist;
 * - the CSS API (`fonts.googleapis.com/css2`), which hands a non-browser
 *   client one static TTF per weight and style, from `fonts.gstatic.com`.
 *
 * Nothing about the user or the organization is sent; only family names.
 */

const METADATA_URL = 'https://fonts.google.com/metadata/fonts'
const CSS_URL = 'https://fonts.googleapis.com/css2'
const FONT_HOST = 'fonts.gstatic.com'
const DAY_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 15_000
const MAX_FONT_BYTES = 5 * 1024 * 1024

export class GoogleFontsUnavailableError extends Error {
  constructor(detail: string) {
    super(`Google Fonts unavailable: ${detail}`)
    this.name = 'GoogleFontsUnavailableError'
  }
}

export interface GoogleFamily {
  family: string
  /** Variant keys as Google lists them: "400", "700i". */
  variants: Set<string>
}

let cache: { at: number; byKey: Map<string, GoogleFamily> } | null = null

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'voteapp-flyer-engine' } })
}

/** The metadata body starts with an anti-JSON-hijacking prefix; parse from the first brace. */
export function parseFamilyMetadata(raw: string): Map<string, GoogleFamily> {
  const json = JSON.parse(raw.slice(raw.indexOf('{'))) as {
    familyMetadataList?: { family: string; fonts?: Record<string, unknown> }[]
  }
  const byKey = new Map<string, GoogleFamily>()
  for (const f of json.familyMetadataList ?? []) {
    byKey.set(familyKey(f.family), { family: f.family, variants: new Set(Object.keys(f.fonts ?? {})) })
  }
  return byKey
}

export async function googleFamilies(now = Date.now()): Promise<Map<string, GoogleFamily>> {
  if (cache && now - cache.at < DAY_MS) return cache.byKey
  let res: Response
  try {
    res = await fetchWithTimeout(METADATA_URL)
  } catch (err) {
    throw new GoogleFontsUnavailableError(err instanceof Error ? err.message : 'fetch failed')
  }
  if (!res.ok) throw new GoogleFontsUnavailableError(`metadata ${res.status}`)
  const byKey = parseFamilyMetadata(await res.text())
  if (byKey.size === 0) throw new GoogleFontsUnavailableError('empty family list')
  cache = { at: now, byKey }
  return byKey
}

/** Test hook. */
export function resetGoogleFontsCache(): void {
  cache = null
}

const variantKey = (weight: number, italic: boolean) => `${weight}${italic ? 'i' : ''}`

/** The available weight closest to the wanted one, in the wanted style if Google has it. */
export function closestVariant(
  family: GoogleFamily,
  weight: number,
  italic: boolean
): { weight: number; italic: boolean } | null {
  const pick = (wantItalic: boolean) => {
    const weights = [...family.variants]
      .filter((v) => v.endsWith('i') === wantItalic)
      .map((v) => Number.parseInt(v, 10))
      .filter((w) => Number.isInteger(w))
    if (weights.length === 0) return null
    weights.sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight) || b - a)
    return { weight: weights[0], italic: wantItalic }
  }
  return family.variants.has(variantKey(weight, italic)) ? { weight, italic } : (pick(italic) ?? pick(!italic))
}

/** The TTF URL in a css2 response, only if it is on Google's font host. */
export function ttfUrlFromCss(css: string): string | null {
  const match = css.match(/url\((https:\/\/[^)\s]+\.ttf)\)/)
  if (!match) return null
  try {
    return new URL(match[1]).host === FONT_HOST ? match[1] : null
  } catch {
    return null
  }
}

async function downloadTtf(family: string, weight: number, italic: boolean): Promise<Uint8Array> {
  const query = `${CSS_URL}?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${italic ? 1 : 0},${weight}`
  let css: Response
  try {
    css = await fetchWithTimeout(query)
  } catch (err) {
    throw new GoogleFontsUnavailableError(err instanceof Error ? err.message : 'css fetch failed')
  }
  if (!css.ok) throw new GoogleFontsUnavailableError(`css ${css.status}`)
  const url = ttfUrlFromCss(await css.text())
  if (!url) throw new GoogleFontsUnavailableError('no truetype source')
  const file = await fetchWithTimeout(url)
  if (!file.ok) throw new GoogleFontsUnavailableError(`font ${file.status}`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_FONT_BYTES) throw new GoogleFontsUnavailableError('font size')
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (!(tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0))) {
    throw new GoogleFontsUnavailableError('not a TrueType file')
  }
  return bytes
}

/** Row and file id for one platform font: the same font is stored once, however many ask at once. */
export function platformFontId(family: string, weight: number, italic: boolean): string {
  return (
    'gf' +
    createHash('sha256')
      .update(`${familyKey(family)}|${weight}|${italic ? 'i' : 'n'}`)
      .digest('hex')
      .slice(0, 30)
  )
}

const code = (err: unknown) => (err as { code?: number })?.code

/**
 * Make one Google font available to every organization: return the stored
 * platform font, or fetch it from Google, store the file and record it.
 */
export async function ensureGoogleFont(family: string, weight: number, italic: boolean): Promise<FontDoc> {
  const id = platformFontId(family, weight, italic)
  const { databases, storage } = createAdminClient()
  const T = APPWRITE.TABLES.FONTS
  try {
    return await withRetry(() => databases.getDocument<FontDoc>(databaseId(), T, id))
  } catch (err) {
    if (code(err) !== 404) throw err
  }
  const bytes = await downloadTtf(family, weight, italic)
  const { InputFile } = await import('node-appwrite/file')
  try {
    await withRetry(() =>
      storage.createFile(
        APPWRITE.BUCKETS.FONTS,
        id,
        InputFile.fromBuffer(bytes, `${family.replace(/[^a-z0-9]+/gi, '-')}-${weight}${italic ? 'i' : ''}.ttf`),
        [Permission.read(Role.any())]
      )
    )
  } catch (err) {
    if (code(err) !== 409) throw err
  }
  try {
    return await withRetry(() =>
      databases.createDocument<FontDoc>(databaseId(), T, id, {
        organizationId: null,
        family,
        fileId: id,
        weight,
        style: italic ? 'italic' : 'normal',
      })
    )
  } catch (err) {
    if (code(err) !== 409) throw err
    return withRetry(() => databases.getDocument<FontDoc>(databaseId(), T, id))
  }
}
