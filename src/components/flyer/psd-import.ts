'use client'

import { planPsd, type PsdLayerLike, type PsdPlan } from '@/lib/flyer/psd-plan'
import type { Layer, Psd } from 'ag-psd'

/**
 * PSD import, the browser half: read the file locally with ag-psd (the PSD
 * itself is never uploaded) and draw the background. See `psd-plan.ts` for
 * the placeholder rules and the fidelity trade-off.
 */

export interface PsdImport {
  plan: PsdPlan
  background: Blob
}

/** Stay under the background route's 30 MB. */
const MAX_BACKGROUND_BYTES = 28 * 1024 * 1024

const BLEND: Partial<Record<string, GlobalCompositeOperation>> = {
  normal: 'source-over',
  'pass through': 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  'linear dodge': 'lighter',
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

/** A layer's pixels with its layer mask applied (mask luminance becomes alpha). */
function maskedPixels(layer: Layer, docW: number, docH: number): HTMLCanvasElement | null {
  if (!layer.canvas) return null
  const out = canvasOf(docW, docH)
  const ctx = out.getContext('2d')!
  ctx.drawImage(layer.canvas, layer.left ?? 0, layer.top ?? 0)
  const mask = layer.mask
  if (mask?.canvas && !mask.disabled) {
    const m = canvasOf(docW, docH)
    const mctx = m.getContext('2d')!
    // Outside the mask's own bounds, Photoshop uses its default colour (0 hides, 255 shows).
    if ((mask.defaultColor ?? 0) > 127) {
      mctx.fillStyle = '#fff'
      mctx.fillRect(0, 0, docW, docH)
    }
    mctx.clearRect(mask.left ?? 0, mask.top ?? 0, mask.canvas.width, mask.canvas.height)
    mctx.drawImage(mask.canvas, mask.left ?? 0, mask.top ?? 0)
    const img = mctx.getImageData(0, 0, docW, docH)
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i + 3] = Math.round((img.data[i] * img.data[i + 3]) / 255)
    }
    mctx.putImageData(img, 0, 0)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(m, 0, 0)
  }
  return out
}

/**
 * Re-draw the visible layers, bottom to top, leaving out the slots. Handles
 * opacity, the common blend modes, groups, layer masks and clipping masks;
 * not layer effects.
 */
function recomposite(psd: Psd, skip: Set<PsdLayerLike>, warn: (w: 'effects') => void): HTMLCanvasElement {
  const { width: W, height: H } = psd
  const draw = (target: CanvasRenderingContext2D, layers: Layer[] | undefined) => {
    const list = layers ?? []
    for (let i = 0; i < list.length; i++) {
      const layer = list[i]
      if (layer.hidden || skip.has(layer as PsdLayerLike)) continue
      if (layer.effects && !(layer.effects as { disabled?: boolean }).disabled) warn('effects')
      let pixels: HTMLCanvasElement | null
      if (layer.children) {
        pixels = canvasOf(W, H)
        draw(pixels.getContext('2d')!, layer.children)
      } else {
        pixels = maskedPixels(layer, W, H)
      }
      if (!pixels) continue
      // Clipping masks: the layers above with `clipping` paint only where this one is opaque.
      while (list[i + 1]?.clipping) {
        const clipped = list[++i]
        if (clipped.hidden || skip.has(clipped as PsdLayerLike)) continue
        const clipPixels = clipped.children ? null : maskedPixels(clipped, W, H)
        if (!clipPixels) continue
        const pctx = pixels.getContext('2d')!
        pctx.globalAlpha = (clipped.opacity ?? 1) as number
        pctx.globalCompositeOperation = 'source-atop'
        pctx.drawImage(clipPixels, 0, 0)
        pctx.globalAlpha = 1
        pctx.globalCompositeOperation = 'source-over'
      }
      target.save()
      target.globalAlpha = (layer.opacity ?? 1) as number
      target.globalCompositeOperation = BLEND[layer.blendMode ?? 'normal'] ?? 'source-over'
      target.drawImage(pixels, 0, 0)
      target.restore()
    }
  }
  const out = canvasOf(W, H)
  draw(out.getContext('2d')!, psd.children)
  return out
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not export the background'))), type, quality)
  )
}

export async function readPsdForImport(file: File): Promise<PsdImport> {
  const { readPsd } = await import('ag-psd')
  const psd = readPsd(await file.arrayBuffer(), { skipThumbnail: true })
  const plan = planPsd(psd as unknown as Parameters<typeof planPsd>[0])
  const warnings = new Set(plan.warnings)

  let canvas: HTMLCanvasElement
  if (plan.exactBackground && psd.canvas) {
    canvas = psd.canvas
  } else {
    if (!psd.canvas) warnings.add('noComposite')
    const skip = new Set(plan.slotLayers.map((s) => s.layer))
    canvas = recomposite(psd, skip, (w) => warnings.add(w))
  }

  let background = await toBlob(canvas, 'image/png')
  if (background.size > MAX_BACKGROUND_BYTES) background = await toBlob(canvas, 'image/jpeg', 0.92)
  return { plan: { ...plan, warnings: [...warnings] }, background }
}
