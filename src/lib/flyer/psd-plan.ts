import { FALLBACK_FONT, MAX_SLOTS, type PhotoSlot, type Slot, type TextBinding, type TextSlot } from './model'

/**
 * PSD import, the pure half (FLYER_ENGINE.md "PSD import", decided
 * 2026-11-12, #19): find the placeholder layers in a parsed PSD and turn them
 * into slots. The browser half (`components/flyer/psd-import.ts`) reads the
 * file with ag-psd and draws the background.
 *
 * Placeholders are layers named, or text layers containing, `{{name}}`,
 * `{{code}}`, `{{category}}`, `{{event}}`, `{{ussd}}` and `{{photo}}`
 * (`{{photo:round}}` for an ellipse). Photoshop names a text layer after its
 * text, so typing `{{name}}` in a text layer is enough. Every other layer is
 * background.
 *
 * Fidelity: if the designer hides the placeholder layers before saving, the
 * background is Photoshop's own flattened image, exact to the pixel. If they
 * are visible, the background is re-drawn from the other layers, which loses
 * layer effects (shadows, strokes) and approximates some blend modes; the
 * importer warns.
 */

/** The subset of ag-psd's `Layer` this module reads. */
export interface PsdTextStyle {
  font?: { name: string }
  fontSize?: number
  fillColor?: { r?: number; g?: number; b?: number; fr?: number; fg?: number; fb?: number }
  fontCaps?: number
}

export interface PsdLayerLike {
  name?: string
  hidden?: boolean
  left?: number
  top?: number
  right?: number
  bottom?: number
  text?: {
    text: string
    transform?: number[]
    style?: PsdTextStyle
    styleRuns?: { style: PsdTextStyle }[]
    paragraphStyle?: { justification?: string }
    shapeType?: 'point' | 'box'
    boxBounds?: number[]
  }
  effects?: { disabled?: boolean } & Record<string, unknown>
  children?: PsdLayerLike[]
}

export interface PsdLike {
  width: number
  height: number
  children?: PsdLayerLike[]
}

export type PlaceholderKind = TextBinding | 'photo'

export interface SlotLayer {
  layer: PsdLayerLike
  kind: PlaceholderKind
  /** Photo only. */
  round: boolean
}

export type PsdWarning = 'noSlots' | 'slotsVisible' | 'effects' | 'duplicatePhoto' | 'tooManySlots' | 'noComposite'

export interface PsdPlan {
  width: number
  height: number
  slotLayers: SlotLayer[]
  /** PostScript names of the fonts the text slots use; these must be available to render. */
  slotFonts: string[]
  /** Every font in the design, for information: static text is baked into the background. */
  designFonts: string[]
  /** All placeholder layers are hidden, so Photoshop's flattened image is the exact background. */
  exactBackground: boolean
  warnings: PsdWarning[]
}

const KINDS: Record<string, PlaceholderKind> = {
  name: 'nominee.name',
  nominee: 'nominee.name',
  code: 'nominee.code',
  category: 'category.name',
  event: 'event.title',
  ussd: 'ussd.instruction',
  photo: 'photo',
}
const ROUND = new Set(['round', 'circle', 'ellipse', 'oval'])
const PLACEHOLDER = /^\{\{\s*([a-z]+)\s*(?::\s*([a-z]+))?\s*\}\}$/i

/** The placeholder a layer stands for, from its name or (text layers) its text. */
export function placeholderOf(layer: PsdLayerLike): { kind: PlaceholderKind; round: boolean } | null {
  for (const candidate of [layer.name, layer.text?.text]) {
    const m = candidate?.trim().match(PLACEHOLDER)
    const kind = m ? KINDS[m[1].toLowerCase()] : undefined
    if (kind) return { kind, round: kind === 'photo' && ROUND.has((m?.[2] ?? '').toLowerCase()) }
  }
  return null
}

function textStyle(layer: PsdLayerLike): PsdTextStyle {
  return layer.text?.style ?? layer.text?.styleRuns?.[0]?.style ?? {}
}

/** Walk the tree, bottom to top as ag-psd lists it, with visibility inherited from groups. */
export function* walkLayers(
  layers: PsdLayerLike[] | undefined,
  parentHidden = false
): Generator<{ layer: PsdLayerLike; hidden: boolean }> {
  for (const layer of layers ?? []) {
    const hidden = parentHidden || layer.hidden === true
    if (layer.children) yield* walkLayers(layer.children, hidden)
    else yield { layer, hidden }
  }
}

export function planPsd(psd: PsdLike): PsdPlan {
  const slotLayers: SlotLayer[] = []
  const warnings = new Set<PsdWarning>()
  const designFonts = new Set<string>()
  let anySlotVisible = false
  let photo = false
  for (const { layer, hidden } of walkLayers(psd.children)) {
    for (const run of [layer.text?.style, ...(layer.text?.styleRuns ?? []).map((r) => r.style)]) {
      if (run?.font?.name) designFonts.add(run.font.name)
    }
    const ph = placeholderOf(layer)
    if (!ph) continue
    if (ph.kind === 'photo') {
      if (photo) {
        warnings.add('duplicatePhoto')
        continue
      }
      photo = true
    } else if (!layer.text) {
      continue // a text placeholder must be a text layer: that is where size, colour and font come from
    }
    if (slotLayers.length >= MAX_SLOTS) {
      warnings.add('tooManySlots')
      continue
    }
    slotLayers.push({ layer, kind: ph.kind, round: ph.round })
    if (!hidden) anySlotVisible = true
  }
  if (slotLayers.length === 0) warnings.add('noSlots')
  if (anySlotVisible) warnings.add('slotsVisible')
  const slotFonts = [
    ...new Set(
      slotLayers.flatMap((s) => (s.kind === 'photo' ? [] : [textStyle(s.layer).font?.name ?? ''])).filter(Boolean)
    ),
  ]
  return {
    width: psd.width,
    height: psd.height,
    slotLayers,
    slotFonts,
    designFonts: [...designFonts],
    exactBackground: !anySlotVisible,
    warnings: [...warnings],
  }
}

export interface ResolvedFont {
  postScriptName: string
  family: string
  weight: number
  italic: boolean
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')
}

export function colorOf(style: PsdTextStyle): string {
  const c = style.fillColor
  if (!c) return '#000000'
  if (c.fr !== undefined || c.fg !== undefined || c.fb !== undefined) {
    return `#${hex((c.fr ?? 0) * 255)}${hex((c.fg ?? 0) * 255)}${hex((c.fb ?? 0) * 255)}`
  }
  return `#${hex(c.r ?? 0)}${hex(c.g ?? 0)}${hex(c.b ?? 0)}`
}

export function alignOf(justification: string | undefined): TextSlot['align'] {
  const j = (justification ?? 'left').replace(/^justify-/, '')
  return j === 'center' || j === 'right' ? j : j === 'all' ? 'center' : 'left'
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Slots for the planned layers, in template pixels: `scale` maps PSD pixels
 * to the stored background (the server shrinks backgrounds over 2160×3840).
 *
 * Point text has no box in the PSD, only the placeholder's own extent, which
 * is shorter than most real names; the slot is widened around the text's
 * anchor (60% of the width, at most 90%) and fits one line. Paragraph text
 * keeps its box.
 */
export function buildSlots(plan: PsdPlan, fonts: ResolvedFont[], scale: number): Slot[] {
  const byName = new Map(fonts.map((f) => [f.postScriptName, f]))
  const W = plan.width
  const slots: Slot[] = []
  plan.slotLayers.forEach((s, i) => {
    const L = s.layer
    const left = L.left ?? 0
    const top = L.top ?? 0
    const right = L.right ?? left
    const bottom = L.bottom ?? top
    if (s.kind === 'photo') {
      const slot: PhotoSlot = {
        id: `psd_photo_${i}`,
        type: 'photo',
        x: Math.round(left * scale),
        y: Math.round(top * scale),
        w: Math.max(1, Math.round((right - left) * scale)),
        h: Math.max(1, Math.round((bottom - top) * scale)),
        rotation: 0,
        shape: s.round ? 'ellipse' : 'rect',
        radius: 0,
      }
      slots.push(slot)
      return
    }
    const text = L.text!
    const style = textStyle(L)
    const t = text.transform ?? [1, 0, 0, 1, left, bottom]
    const k = Math.hypot(t[0], t[1]) || 1
    const rotation = Math.round((Math.atan2(t[1], t[0]) * 180) / Math.PI)
    const fontSize = Math.max(4, (style.fontSize ?? 24) * k)
    const align = alignOf(text.paragraphStyle?.justification)
    let x: number, y: number, w: number, h: number, maxLines: number
    if (text.shapeType === 'box' && text.boxBounds && text.boxBounds.length === 4) {
      const [bl, bt, br, bb] = text.boxBounds
      x = t[4] + bl * k
      y = t[5] + bt * k
      w = (br - bl) * k
      h = (bb - bt) * k
      maxLines = clamp(Math.floor(h / (fontSize * 1.2)), 1, 6)
    } else {
      let [pl, pt, pr, pb] = [left, top, right, bottom]
      if (pr - pl < 1 || pb - pt < 1) {
        // No pixel bounds (an empty or never-rendered layer): estimate from the
        // baseline anchor in the transform and the font size.
        const est = fontSize * 0.55 * Math.max(1, text.text.length)
        pl = align === 'left' ? t[4] : align === 'right' ? t[4] - est : t[4] - est / 2
        pr = pl + est
        pt = t[5] - fontSize * 0.8
        pb = t[5] + fontSize * 0.2
      }
      const bw = Math.max(1, pr - pl)
      const bh = Math.max(1, pb - pt)
      w = Math.min(W * 0.9, Math.max(bw, W * 0.6))
      h = Math.max(bh, fontSize * 1.25)
      y = pt + bh / 2 - h / 2
      x = align === 'left' ? pl : align === 'right' ? pr - w : (pl + pr) / 2 - w / 2
      if (w <= W) x = clamp(x, 0, W - w)
      maxLines = 1
    }
    const font = byName.get(style.font?.name ?? '')
    const size = Math.max(4, Math.round(fontSize * scale))
    const slot: TextSlot = {
      id: `psd_text_${i}`,
      type: 'text',
      x: Math.round(x * scale),
      y: Math.round(y * scale),
      w: Math.max(1, Math.round(w * scale)),
      h: Math.max(1, Math.round(h * scale)),
      rotation,
      binding: s.kind as TextBinding,
      text: '',
      fontFamily: font?.family ?? FALLBACK_FONT,
      fontWeight: font?.weight ?? 700,
      ...(font?.italic ? { italic: true } : {}),
      fontSize: size,
      minFontSize: Math.max(4, Math.min(size, Math.round(size * 0.5))),
      color: colorOf(style),
      align,
      uppercase: style.fontCaps === 2,
      maxLines,
    }
    slots.push(slot)
  })
  return slots
}
