import { GlobalFonts, createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import path from 'path'
import { privacyNotice, resolveBinding, type BindingContext } from './bindings'
import { coverCrop, fitText, placePhoto } from './layout'
import { FALLBACK_FONT, type PhotoSlot, type SlotModel, type TextSlot } from './model'

/**
 * Server renderer. Draws a template's background, the nominee photo into the
 * photo slot, the foreground (layers the design puts above the photo, drawn
 * right after the photo slot so text slots after it stay on top), and each
 * text slot's resolved binding, and returns a PNG of the
 * template's size (FLYER_ENGINE.md "Generation"). `@napi-rs/canvas` ships
 * prebuilt binaries, so this runs on serverless hosts without a native build;
 * see ARCHITECTURE.md "Added for this product".
 *
 * Fonts: TTF/OTF files are registered once per process by family name. A
 * family that was never registered falls back to the host's sans-serif.
 */
export interface FontFile {
  family: string
  path: string
}

export interface RenderInputs {
  width: number
  height: number
  background: Uint8Array | null
  photo: Uint8Array | null
  /** Percent point of the photo kept in the frame and zoom in percent; centre at 100 when absent (`photo-focus.ts`). */
  photoFocus?: { x: number; y: number; zoom?: number }
  /** Transparent PNG over the photo; stretched to the template size. */
  foreground?: Uint8Array | null
  /** Alpha mask for a photo slot with shape `mask`; stretched to the slot. Without it, `mask` is a rectangle. */
  photoMask?: Uint8Array | null
  model: SlotModel
  context: BindingContext
  fonts: FontFile[]
}

/**
 * Bump when a change to the renderer or its built-in fonts would make an
 * existing flyer look different. It is part of each flyer's source hash, so
 * the next `ensureFlyer` re-renders flyers made by an older renderer.
 */
export const RENDERER_VERSION = 3

const registered = new Set<string>()

export function registerFonts(fonts: FontFile[]): void {
  for (const f of fonts) {
    const key = `${f.family}@${f.path}`
    if (registered.has(key)) continue
    try {
      GlobalFonts.registerFromPath(f.path, f.family)
      registered.add(key)
    } catch (err) {
      console.warn(`[flyer] could not register font ${f.family} from ${f.path}:`, err)
    }
  }
}

/**
 * The default slot font (`FALLBACK_FONT`, Poppins, the app font) ships with the
 * renderer so flyers match the editor without an upload: seven static weights
 * under the SIL Open Font License, in `./fonts/poppins`. Read from the project
 * root at runtime; `next.config.mjs` traces them into the serverless bundle.
 */
const BUILTIN_FONT_DIR = path.join(process.cwd(), 'src', 'lib', 'flyer', 'fonts', 'poppins')
const BUILTIN_WEIGHTS = ['Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black']

export function builtinFonts(): FontFile[] {
  return BUILTIN_WEIGHTS.map((w) => ({ family: FALLBACK_FONT, path: path.join(BUILTIN_FONT_DIR, `Poppins-${w}.ttf`) }))
}

function fontSpec(slot: TextSlot, size: number): string {
  return `${slot.italic ? 'italic ' : ''}${slot.fontWeight} ${size}px "${slot.fontFamily}", sans-serif`
}

function clipPhoto(ctx: SKRSContext2D, slot: PhotoSlot): void {
  const { w, h } = slot
  ctx.beginPath()
  if (slot.shape === 'ellipse') {
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
  } else {
    const r = Math.max(0, Math.min(slot.radius, w / 2, h / 2))
    const x = -w / 2
    const y = -h / 2
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
  }
  ctx.closePath()
  ctx.clip()
}

export async function renderFlyer(inputs: RenderInputs): Promise<Uint8Array> {
  // Built-ins first, so an organization's own upload under the same family can still add faces.
  registerFonts([...builtinFonts(), ...inputs.fonts])
  const canvas = createCanvas(inputs.width, inputs.height)
  const ctx = canvas.getContext('2d')

  if (inputs.background) {
    const bg = await loadImage(Buffer.from(inputs.background))
    const crop = coverCrop(bg.width, bg.height, inputs.width, inputs.height)
    ctx.drawImage(bg, crop.x, crop.y, crop.w, crop.h, 0, 0, inputs.width, inputs.height)
  } else {
    ctx.fillStyle = '#111827'
    ctx.fillRect(0, 0, inputs.width, inputs.height)
  }

  const photo = inputs.photo ? await loadImage(Buffer.from(inputs.photo)) : null
  const foreground = inputs.foreground ? await loadImage(Buffer.from(inputs.foreground)) : null
  const mask = inputs.photoMask ? await loadImage(Buffer.from(inputs.photoMask)) : null
  let foregroundDrawn = false
  const drawForeground = () => {
    if (foreground && !foregroundDrawn) ctx.drawImage(foreground, 0, 0, inputs.width, inputs.height)
    foregroundDrawn = true
  }
  // No photo slot: the foreground goes straight over the background, under every text slot.
  if (!inputs.model.slots.some((sl) => sl.type === 'photo')) drawForeground()

  for (const slot of inputs.model.slots) {
    ctx.save()
    ctx.translate(slot.x + slot.w / 2, slot.y + slot.h / 2)
    ctx.rotate((slot.rotation * Math.PI) / 180)

    if (slot.type === 'photo') {
      clipPhoto(ctx, slot)
      // Draw the photo (or its placeholder) on its own layer so a mask can cut it.
      const w = Math.max(1, Math.round(slot.w))
      const h = Math.max(1, Math.round(slot.h))
      const layer = createCanvas(w, h)
      const lctx = layer.getContext('2d')
      if (photo) {
        const focus = inputs.photoFocus ?? { x: 50, y: 50 }
        const { src, dst } = placePhoto(photo.width, photo.height, w, h, {
          fit: slot.fit,
          zoom: (focus.zoom ?? 100) / 100,
          focusX: focus.x / 100,
          focusY: focus.y / 100,
        })
        lctx.drawImage(photo, src.x, src.y, src.w, src.h, dst.x, dst.y, dst.w, dst.h)
      } else {
        lctx.fillStyle = '#9ca3af'
        lctx.fillRect(0, 0, w, h)
      }
      if (slot.shape === 'mask' && mask) {
        lctx.globalCompositeOperation = 'destination-in'
        lctx.drawImage(mask, 0, 0, w, h)
      }
      ctx.drawImage(layer, -slot.w / 2, -slot.h / 2, slot.w, slot.h)
      ctx.restore()
      drawForeground()
      continue
    } else {
      const text = resolveBinding(slot, inputs.context)
      const measure = (t: string, size: number) => {
        ctx.font = fontSpec(slot, size)
        return ctx.measureText(t).width
      }
      const fit = fitText(
        {
          text,
          maxWidth: slot.w,
          maxHeight: slot.h,
          fontSize: slot.fontSize,
          minFontSize: slot.minFontSize,
          maxLines: slot.maxLines,
        },
        measure
      )
      ctx.font = fontSpec(slot, fit.fontSize)
      ctx.fillStyle = slot.color
      ctx.textAlign = slot.align
      ctx.textBaseline = 'middle'
      const lineHeight = fit.fontSize * 1.2
      const totalHeight = fit.lines.length * lineHeight
      const startY = -totalHeight / 2 + lineHeight / 2
      const x = slot.align === 'left' ? -slot.w / 2 : slot.align === 'right' ? slot.w / 2 : 0
      fit.lines.forEach((line, i) => ctx.fillText(line, x, startY + i * lineHeight))
    }
    ctx.restore()
  }

  // Decision #28: every flyer names the privacy policy. A template whose
  // designer placed no privacy slot gets a small line along the bottom.
  if (!inputs.model.slots.some((sl) => sl.type === 'text' && sl.binding === 'privacy.notice')) {
    drawPrivacyLine(ctx, inputs.width, inputs.height, privacyNotice(inputs.context.appUrl))
  }

  return new Uint8Array(canvas.toBuffer('image/png'))
}

/**
 * The fallback privacy line: white text on a translucent dark band, so it
 * reads on any design, sized to the flyer (about 1.6% of its height, never
 * below 12px) and shrunk to fit its width.
 */
function drawPrivacyLine(ctx: SKRSContext2D, width: number, height: number, text: string): void {
  const size = Math.max(12, Math.round(height * 0.016))
  const maxWidth = width * 0.94
  const spec = (s: number) => `400 ${s}px "${FALLBACK_FONT}"`
  const fit = fitText(
    { text, maxWidth, maxHeight: size * 1.2, fontSize: size, minFontSize: Math.min(size, 8), maxLines: 1 },
    (t, s) => {
      ctx.font = spec(s)
      return ctx.measureText(t).width
    }
  )
  const band = Math.round(fit.fontSize * 2)
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
  ctx.fillRect(0, height - band, width, band)
  ctx.font = spec(fit.fontSize)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(fit.lines[0] ?? '', width / 2, height - band / 2)
  ctx.restore()
}

/** Solid-colour PNG, for tests and for a template that has no background yet. */
export function solidPng(width: number, height: number, color: string): Uint8Array {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  return new Uint8Array(canvas.toBuffer('image/png'))
}
