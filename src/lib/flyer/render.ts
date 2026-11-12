import { GlobalFonts, createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import path from 'path'
import { resolveBinding, type BindingContext } from './bindings'
import { coverCrop, fitText } from './layout'
import { FALLBACK_FONT, type PhotoSlot, type SlotModel, type TextSlot } from './model'

/**
 * Server renderer. Draws a template's background, the nominee photo into the
 * photo slot, and each text slot's resolved binding, and returns a PNG of the
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
  model: SlotModel
  context: BindingContext
  fonts: FontFile[]
}

/**
 * Bump when a change to the renderer or its built-in fonts would make an
 * existing flyer look different. It is part of each flyer's source hash, so
 * the next `ensureFlyer` re-renders flyers made by an older renderer.
 */
export const RENDERER_VERSION = 2

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
  return `${slot.fontWeight} ${size}px "${slot.fontFamily}", sans-serif`
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

  for (const slot of inputs.model.slots) {
    ctx.save()
    ctx.translate(slot.x + slot.w / 2, slot.y + slot.h / 2)
    ctx.rotate((slot.rotation * Math.PI) / 180)

    if (slot.type === 'photo') {
      clipPhoto(ctx, slot)
      if (photo) {
        const crop = coverCrop(photo.width, photo.height, slot.w, slot.h)
        ctx.drawImage(photo, crop.x, crop.y, crop.w, crop.h, -slot.w / 2, -slot.h / 2, slot.w, slot.h)
      } else {
        ctx.fillStyle = '#9ca3af'
        ctx.fillRect(-slot.w / 2, -slot.h / 2, slot.w, slot.h)
      }
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

  return new Uint8Array(canvas.toBuffer('image/png'))
}

/** Solid-colour PNG, for tests and for a template that has no background yet. */
export function solidPng(width: number, height: number, color: string): Uint8Array {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  return new Uint8Array(canvas.toBuffer('image/png'))
}
