import type { TextSlot } from './model'

/**
 * Resolves a text slot's binding to the string that goes on the flyer. The
 * USSD instruction needs the shortcode, which comes from Hubtel onboarding:
 * `USSD_SHORTCODE` (e.g. `*713*42#`), with a visible placeholder until set.
 */
export interface BindingContext {
  nomineeName: string
  nomineeCode: string
  categoryName: string
  eventTitle: string
  ussdShortcode?: string | null
  /** The app's public URL (`NEXT_PUBLIC_APP_URL`); the privacy notice points at its `/privacy` page. */
  appUrl?: string | null
}

export const USSD_SHORTCODE_PLACEHOLDER = '*XXX*YY#'

export function ussdInstruction(code: string, shortcode?: string | null): string {
  const dial = (shortcode ?? '').trim() || USSD_SHORTCODE_PLACEHOLDER
  return `Dial ${dial}, enter ${code}`
}

export const PRIVACY_ADDRESS_PLACEHOLDER = 'yoursite.com/privacy'

/**
 * The privacy notice every flyer carries (decision #28: USSD voters are
 * covered by the policy named on the website and on flyers). The address is
 * the app's host and path without the scheme, e.g. `voteapp.com/privacy`.
 */
export function privacyNotice(appUrl?: string | null): string {
  const base = (appUrl ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  return `Privacy policy: ${base ? `${base}/privacy` : PRIVACY_ADDRESS_PLACEHOLDER}`
}

export function resolveBinding(slot: Pick<TextSlot, 'binding' | 'text' | 'uppercase'>, ctx: BindingContext): string {
  let value: string
  switch (slot.binding) {
    case 'nominee.name':
      value = ctx.nomineeName
      break
    case 'nominee.code':
      value = ctx.nomineeCode
      break
    case 'category.name':
      value = ctx.categoryName
      break
    case 'event.title':
      value = ctx.eventTitle
      break
    case 'ussd.instruction':
      value = ussdInstruction(ctx.nomineeCode, ctx.ussdShortcode)
      break
    case 'privacy.notice':
      value = privacyNotice(ctx.appUrl)
      break
    case 'custom':
      value = slot.text ?? ''
      break
  }
  value = value.replace(/\s+/g, ' ').trim()
  return slot.uppercase ? value.toUpperCase() : value
}

/** Sample context for the editor's preview. */
export const SAMPLE_CONTEXT: BindingContext = {
  nomineeName: 'Ama Owusu',
  nomineeCode: '4321',
  categoryName: 'Miss Social Science',
  eventTitle: 'Faculty Awards 2026',
  ussdShortcode: process.env.USSD_SHORTCODE ?? null,
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
}
