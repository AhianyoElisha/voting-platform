/**
 * An organization's branding (PRD 5.1): two colours stored as JSON in
 * `organizations.brandColors`. Pure, shared by the settings form, the server
 * and the public pages.
 */

export interface BrandColors {
  /** Header band on the public event and vote pages. */
  primary: string
  /** Second colour: the band's accent stripe. */
  accent: string | null
}

const HEX = /^#[0-9a-f]{6}$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

/** Stored JSON to colours; anything malformed means no branding. */
export function parseBrandColors(raw: string | null | undefined): BrandColors | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    if (!isHexColor(v.primary)) return null
    return { primary: v.primary.toLowerCase(), accent: isHexColor(v.accent) ? v.accent.toLowerCase() : null }
  } catch {
    return null
  }
}

export function serializeBrandColors(colors: BrandColors | null): string | null {
  return colors
    ? JSON.stringify({ primary: colors.primary.toLowerCase(), accent: colors.accent?.toLowerCase() ?? null })
    : null
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** White or near-black, whichever reads better on the colour (higher contrast ratio). */
export function textColorOn(hex: string): '#ffffff' | '#111827' {
  const l = luminance(hex)
  const onWhite = 1.05 / (l + 0.05)
  const onDark = (l + 0.05) / (luminance('#111827') + 0.05)
  return onWhite >= onDark ? '#ffffff' : '#111827'
}
