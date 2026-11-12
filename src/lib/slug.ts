/**
 * Organization slugs. Public pages resolve the tenant from the slug
 * (`/o/{slug}/...`, ARCHITECTURE.md "Multi-tenancy"), so a slug is a URL
 * segment: lowercase ASCII letters, digits and single hyphens.
 */
export const SLUG_MIN = 3
export const SLUG_MAX = 48

/** Top-level routes a slug must not collide with, plus words we keep for ourselves. */
const RESERVED = new Set([
  'o',
  'api',
  'admin',
  'account',
  'dashboard',
  'portal',
  'login',
  'signup',
  'forgot-password',
  'reset-password',
  'events',
  'vote',
  'tickets',
  'monitoring',
  'voteapp',
  'www',
  'app',
  'help',
  'support',
])

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** "Faculty of Social Sciences" → "faculty-of-social-sciences". Never throws; may return ''. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
}

export type SlugProblem = 'tooShort' | 'tooLong' | 'invalid' | 'reserved'

/** `null` when the slug is acceptable, otherwise why not. */
export function validateSlug(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN) return 'tooShort'
  if (slug.length > SLUG_MAX) return 'tooLong'
  if (!SLUG_PATTERN.test(slug)) return 'invalid'
  if (RESERVED.has(slug)) return 'reserved'
  return null
}

export function isValidSlug(slug: string): boolean {
  return validateSlug(slug) === null
}
