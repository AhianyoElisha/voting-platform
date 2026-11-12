/**
 * Font names as a PSD stores them. Photoshop records each text run's font by
 * its PostScript name ("PlayfairDisplay-BlackItalic"), not by family, weight
 * and style. These helpers turn one into the other. Pure; shared by the
 * browser importer and the server.
 */

export interface ParsedFontName {
  postScriptName: string
  /** Family part with spaces removed, e.g. "PlayfairDisplay", "RobotoCondensed". */
  base: string
  weight: number
  italic: boolean
}

// Longest first, so "extrabold" is not read as "bold".
const WEIGHT_TOKENS: [string, number][] = [
  ['extralight', 200],
  ['ultralight', 200],
  ['semibold', 600],
  ['demibold', 600],
  ['extrabold', 800],
  ['ultrabold', 800],
  ['hairline', 100],
  ['regular', 400],
  ['medium', 500],
  ['normal', 400],
  ['light', 300],
  ['black', 900],
  ['heavy', 900],
  ['thin', 100],
  ['book', 400],
  ['bold', 700],
]

/** Lowercase letters and digits only: how family names are compared. */
export function familyKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function parsePostScriptName(postScriptName: string): ParsedFontName {
  const name = postScriptName.trim()
  const [head, ...rest] = name.split('-')
  // Work on the original casing so leftovers keep it ("Arial-BoldMT" → "ArialMT").
  let style = rest.join('')
  let italic = false
  if (/italic|oblique/i.test(style)) {
    italic = true
    style = style.replace(/italic|oblique/gi, '')
  }
  let weight = 400
  for (const [token, value] of WEIGHT_TOKENS) {
    const at = style.toLowerCase().indexOf(token)
    if (at !== -1) {
      weight = value
      style = style.slice(0, at) + style.slice(at + token.length)
      break
    }
  }
  // Anything left belongs to the family ("RobotoCondensed-Bold", "Roboto-CondensedBold").
  const leftover = style.replace(/[^A-Za-z0-9]/g, '')
  const tail = leftover ? leftover[0].toUpperCase() + leftover.slice(1) : ''
  return { postScriptName: name, base: (head + tail).replace(/[^A-Za-z0-9]/g, ''), weight, italic }
}

/** "PlayfairDisplay" → "Playfair Display": a display guess for fonts Google does not have. */
export function spacedFamily(base: string): string {
  return base
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
}
