/**
 * The slot model: what a template is, beyond its background image. This is
 * what the editor saves and the server renders, so the two never drift. It is
 * deliberately small (CLAUDE.md rule 7): a photo frame and text slots bound to
 * data, each with position, size, rotation and style. Nothing else.
 *
 * Coordinates are in template pixels, origin top-left, rotation in degrees
 * around the slot's centre.
 */
export const TEXT_BINDINGS = [
  'nominee.name',
  'nominee.code',
  'category.name',
  'event.title',
  'ussd.instruction',
  'custom',
] as const
export type TextBinding = (typeof TEXT_BINDINGS)[number]

export interface PhotoSlot {
  id: string
  type: 'photo'
  x: number
  y: number
  w: number
  h: number
  rotation: number
  shape: 'rect' | 'ellipse'
  /** Corner radius for `rect`, in template pixels. */
  radius: number
}

export interface TextSlot {
  id: string
  type: 'text'
  x: number
  y: number
  w: number
  h: number
  rotation: number
  binding: TextBinding
  /** Only for `custom`. */
  text: string
  /** Font family name; must match an uploaded Font or a fallback. */
  fontFamily: string
  fontWeight: number
  fontSize: number
  /** Shrink-to-fit floor. */
  minFontSize: number
  color: string
  align: 'left' | 'center' | 'right'
  uppercase: boolean
  maxLines: number
}

export type Slot = PhotoSlot | TextSlot

export interface SlotModel {
  version: 1
  slots: Slot[]
}

export const EMPTY_MODEL: SlotModel = { version: 1, slots: [] }
export const MAX_SLOTS = 20
export const FALLBACK_FONT = 'Poppins'

const COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

export type ModelProblem = string

/** Returns the problems found, empty when the model is valid for a template of the given size. */
export function validateModel(input: unknown, width: number, height: number): ModelProblem[] {
  const problems: string[] = []
  if (!input || typeof input !== 'object') return ['model must be an object']
  const m = input as Partial<SlotModel>
  if (m.version !== 1) problems.push('version must be 1')
  if (!Array.isArray(m.slots)) return [...problems, 'slots must be an array']
  if (m.slots.length > MAX_SLOTS) problems.push(`at most ${MAX_SLOTS} slots`)
  const ids = new Set<string>()
  let photos = 0
  m.slots.forEach((raw, i) => {
    const s = raw as Partial<Slot>
    const tag = `slot ${i}`
    if (typeof s.id !== 'string' || !s.id) problems.push(`${tag}: id required`)
    else if (ids.has(s.id)) problems.push(`${tag}: duplicate id ${s.id}`)
    else ids.add(s.id)
    for (const k of ['x', 'y', 'w', 'h', 'rotation'] as const) {
      if (!num(s[k])) problems.push(`${tag}: ${k} must be a number`)
    }
    if (num(s.w) && (s.w as number) <= 0) problems.push(`${tag}: w must be positive`)
    if (num(s.h) && (s.h as number) <= 0) problems.push(`${tag}: h must be positive`)
    if (num(s.x) && num(s.w) && ((s.x as number) < -width || (s.x as number) > 2 * width))
      problems.push(`${tag}: x out of range`)
    if (num(s.y) && num(s.h) && ((s.y as number) < -height || (s.y as number) > 2 * height))
      problems.push(`${tag}: y out of range`)
    if (s.type === 'photo') {
      photos += 1
      const p = s as Partial<PhotoSlot>
      if (p.shape !== 'rect' && p.shape !== 'ellipse') problems.push(`${tag}: shape must be rect or ellipse`)
      if (!num(p.radius) || (p.radius as number) < 0) problems.push(`${tag}: radius must be >= 0`)
    } else if (s.type === 'text') {
      const t = s as Partial<TextSlot>
      if (!TEXT_BINDINGS.includes(t.binding as TextBinding)) problems.push(`${tag}: unknown binding`)
      if (t.binding === 'custom' && typeof t.text !== 'string') problems.push(`${tag}: custom text required`)
      if (typeof t.fontFamily !== 'string' || !t.fontFamily) problems.push(`${tag}: fontFamily required`)
      if (!num(t.fontWeight) || (t.fontWeight as number) < 100 || (t.fontWeight as number) > 900)
        problems.push(`${tag}: fontWeight 100..900`)
      if (!num(t.fontSize) || (t.fontSize as number) < 4) problems.push(`${tag}: fontSize >= 4`)
      if (
        !num(t.minFontSize) ||
        (t.minFontSize as number) < 4 ||
        (num(t.fontSize) && (t.minFontSize as number) > (t.fontSize as number))
      ) {
        problems.push(`${tag}: minFontSize between 4 and fontSize`)
      }
      if (typeof t.color !== 'string' || !COLOR.test(t.color)) problems.push(`${tag}: color must be #rrggbb`)
      if (!['left', 'center', 'right'].includes(t.align as string)) problems.push(`${tag}: align`)
      if (typeof t.uppercase !== 'boolean') problems.push(`${tag}: uppercase must be boolean`)
      if (!num(t.maxLines) || (t.maxLines as number) < 1 || (t.maxLines as number) > 6)
        problems.push(`${tag}: maxLines 1..6`)
    } else {
      problems.push(`${tag}: type must be photo or text`)
    }
  })
  if (photos > 1) problems.push('at most one photo slot')
  return problems
}

export function parseModel(raw: string | null | undefined, width: number, height: number): SlotModel {
  if (!raw) return EMPTY_MODEL
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_MODEL
  }
  return validateModel(parsed, width, height).length === 0 ? (parsed as SlotModel) : EMPTY_MODEL
}

export function newPhotoSlot(width: number, height: number): PhotoSlot {
  const size = Math.round(Math.min(width, height) * 0.45)
  return {
    id: `photo_${Date.now().toString(36)}`,
    type: 'photo',
    x: Math.round((width - size) / 2),
    y: Math.round(height * 0.2),
    w: size,
    h: size,
    rotation: 0,
    shape: 'ellipse',
    radius: 0,
  }
}

export function newTextSlot(width: number, height: number, binding: TextBinding): TextSlot {
  return {
    id: `text_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`,
    type: 'text',
    x: Math.round(width * 0.1),
    y: Math.round(height * 0.7),
    w: Math.round(width * 0.8),
    h: Math.round(height * 0.08),
    rotation: 0,
    binding,
    text: binding === 'custom' ? 'Text' : '',
    fontFamily: FALLBACK_FONT,
    fontWeight: 700,
    fontSize: Math.round(height * 0.05),
    minFontSize: 12,
    color: '#ffffff',
    align: 'center',
    uppercase: false,
    maxLines: 1,
  }
}
