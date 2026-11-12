import type { TenantContext } from '../db'
import { assertCanDesign } from '../tenant'
import { familyKey, parsePostScriptName, spacedFamily } from './font-names'
import { GoogleFontsUnavailableError, closestVariant, ensureGoogleFont, googleFamilies } from './google-fonts'
import { FALLBACK_FONT } from './model'
import { listFonts } from './templates-server'

/**
 * The font detector behind PSD import: for each PostScript name found in a
 * template's text slots, say which font to use and make it available.
 *
 * - `available`: the organization or the platform already has it (or it is
 *   the built-in Poppins).
 * - `fetched`: it is on Google Fonts and is now stored as a platform font,
 *   usable by every organization. `weight`/`italic` may be the closest variant
 *   Google has, flagged by `substituted`.
 * - `upload`: not on Google Fonts. Someone in the organization who holds a
 *   licence uploads it under `family` with this weight and style; it then
 *   stays private to the organization.
 */

export type FontResolution = {
  postScriptName: string
  family: string
  weight: number
  italic: boolean
  status: 'available' | 'fetched' | 'upload'
  substituted?: boolean
  /** Google Fonts could not be reached, so a free font may be among the `upload` ones. */
  googleUnavailable?: boolean
}

export const MAX_FONTS_PER_RESOLVE = 20
// Poppins ships with the renderer (render.ts) in these weights, upright only.
const BUILTIN_WEIGHTS = new Set([300, 400, 500, 600, 700, 800, 900])

export async function resolveFonts(ctx: TenantContext, postScriptNames: string[]): Promise<FontResolution[]> {
  assertCanDesign(ctx)
  const names = [...new Set(postScriptNames.map((n) => n.trim()).filter((n) => n && n.length <= 128))].slice(
    0,
    MAX_FONTS_PER_RESOLVE
  )
  if (names.length === 0) return []
  const owned = await listFonts(ctx.organizationId)
  const has = (key: string, weight: number, italic: boolean) =>
    owned.find((f) => familyKey(f.family) === key && f.weight === weight && (f.style === 'italic') === italic) ?? null

  let google: Awaited<ReturnType<typeof googleFamilies>> | null = null
  let googleDown = false
  const out: FontResolution[] = []
  for (const postScriptName of names) {
    const parsed = parsePostScriptName(postScriptName)
    const key = familyKey(parsed.base)
    const base = { postScriptName, weight: parsed.weight, italic: parsed.italic }

    if (key === familyKey(FALLBACK_FONT) && !parsed.italic && BUILTIN_WEIGHTS.has(parsed.weight)) {
      out.push({ ...base, family: FALLBACK_FONT, status: 'available' })
      continue
    }
    const mine = has(key, parsed.weight, parsed.italic)
    if (mine) {
      out.push({ ...base, family: mine.family, status: 'available' })
      continue
    }

    if (!google && !googleDown) {
      try {
        google = await googleFamilies()
      } catch (err) {
        if (!(err instanceof GoogleFontsUnavailableError)) throw err
        console.warn('[fonts.resolve]', err.message)
        googleDown = true
      }
    }
    const family = google?.get(key)
    const variant = family ? closestVariant(family, parsed.weight, parsed.italic) : null
    if (family && variant) {
      const existing = has(key, variant.weight, variant.italic)
      try {
        if (!existing) await ensureGoogleFont(family.family, variant.weight, variant.italic)
        out.push({
          postScriptName,
          family: family.family,
          weight: variant.weight,
          italic: variant.italic,
          status: existing ? 'available' : 'fetched',
          ...(variant.weight !== parsed.weight || variant.italic !== parsed.italic ? { substituted: true } : {}),
        })
        continue
      } catch (err) {
        if (!(err instanceof GoogleFontsUnavailableError)) throw err
        console.warn('[fonts.resolve]', err.message)
        googleDown = true
      }
    }
    out.push({
      ...base,
      family: family?.family ?? spacedFamily(parsed.base),
      status: 'upload',
      ...(googleDown ? { googleUnavailable: true } : {}),
    })
  }
  return out
}
