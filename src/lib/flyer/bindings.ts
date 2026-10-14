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
}

export const USSD_SHORTCODE_PLACEHOLDER = '*XXX*YY#'

export function ussdInstruction(code: string, shortcode?: string | null): string {
  const dial = (shortcode ?? '').trim() || USSD_SHORTCODE_PLACEHOLDER
  return `Dial ${dial}, enter ${code}`
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
}
