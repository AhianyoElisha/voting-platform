'use client'

import {
  bezierSegments,
  clippingBase,
  colorOf,
  foregroundLayers,
  layerBox,
  planPsd,
  type Box,
  type PsdLayerLike,
  type PsdPlan,
  type PsdWarning,
} from '@/lib/flyer/psd-plan'
import type { Layer, Psd } from 'ag-psd'

/**
 * PSD import, the browser half: read the file locally with ag-psd (the PSD
 * itself is never uploaded) and draw the background. See `psd-plan.ts` for
 * the placeholder rules and the fidelity trade-off.
 */

export interface PsdImport {
  plan: PsdPlan
  background: Blob
  /** The layers above the photo, kept only over the photo's area; null when there are none. */
  foreground: Blob | null
  /** The photo placeholder's shape (its pixels, mask, or the shape it is clipped to), cropped to the slot; null when it is a plain rectangle. */
  photoMask: Blob | null
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
 * A shape layer (rectangle, ellipse, pen path) that stores only its vector
 * path and fill, no pixels. Solid colour fills and strokes are drawn; gradient
 * and pattern fills are not (the caller warns).
 */
function vectorPixels(
  layer: Layer,
  docW: number,
  docH: number,
  warn: (w: PsdWarning) => void
): HTMLCanvasElement | null {
  const paths = layer.vectorMask?.paths
  if (!paths?.length || layer.vectorMask?.disable) return null
  const path = new Path2D()
  for (const p of paths) {
    for (const seg of bezierSegments(p)) {
      if (seg.op === 'move') path.moveTo(seg.x, seg.y)
      else if (seg.op === 'curve') path.bezierCurveTo(seg.c1x, seg.c1y, seg.c2x, seg.c2y, seg.x, seg.y)
      else path.closePath()
    }
  }
  const out = canvasOf(docW, docH)
  const ctx = out.getContext('2d')!
  const evenOdd = paths.some((p) => p.fillRule === 'even-odd')
  const stroke = layer.vectorStroke
  const fill = layer.vectorFill
  if (fill && stroke?.fillEnabled !== false) {
    if (fill.type === 'color') {
      ctx.fillStyle = colorOf({ fillColor: fill.color as Parameters<typeof colorOf>[0]['fillColor'] })
      ctx.fill(path, evenOdd ? 'evenodd' : 'nonzero')
    } else {
      warn('shapeFill')
    }
  }
  if (stroke?.strokeEnabled && stroke.content?.type === 'color' && stroke.lineWidth?.value) {
    ctx.strokeStyle = colorOf({ fillColor: stroke.content.color as Parameters<typeof colorOf>[0]['fillColor'] })
    ctx.lineWidth = stroke.lineWidth.value
    ctx.globalAlpha = stroke.opacity ?? 1
    ctx.stroke(path)
  }
  return out
}

/**
 * Re-draw the visible layers that `include` accepts, bottom to top. Handles
 * opacity, the common blend modes, groups, layer masks, clipping masks and
 * solid-colour shape layers; not layer effects. A layer left out takes the
 * layers clipped to it along.
 */
function recomposite(
  psd: Psd,
  include: (layer: PsdLayerLike) => boolean,
  warn: (w: PsdWarning) => void
): HTMLCanvasElement {
  const { width: W, height: H } = psd
  const draw = (target: CanvasRenderingContext2D, layers: Layer[] | undefined) => {
    const list = layers ?? []
    for (let i = 0; i < list.length; i++) {
      const layer = list[i]
      if (layer.hidden || (!layer.children && !include(layer as PsdLayerLike))) {
        while (list[i + 1]?.clipping) i++
        continue
      }
      if (layer.effects && !(layer.effects as { disabled?: boolean }).disabled) warn('effects')
      let pixels: HTMLCanvasElement | null
      if (layer.children) {
        pixels = canvasOf(W, H)
        draw(pixels.getContext('2d')!, layer.children)
      } else {
        pixels = maskedPixels(layer, W, H) ?? vectorPixels(layer, W, H, warn)
      }
      if (!pixels) continue
      // Clipping masks: the layers above with `clipping` paint only where this one is opaque.
      while (list[i + 1]?.clipping) {
        const clipped = list[++i]
        if (clipped.hidden || !include(clipped as PsdLayerLike)) continue
        const clipPixels = clipped.children ? null : (maskedPixels(clipped, W, H) ?? vectorPixels(clipped, W, H, warn))
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

/** The pixels of one layer (raster with its mask, or a drawn shape), document-sized. */
function pixelsOf(layer: Layer, W: number, H: number, warn: (w: PsdWarning) => void): HTMLCanvasElement | null {
  return maskedPixels(layer, W, H) ?? vectorPixels(layer, W, H, warn)
}

/** Crop a document-sized canvas to a box. */
function crop(source: HTMLCanvasElement, box: Box): HTMLCanvasElement {
  const w = Math.max(1, Math.round(box.right - box.left))
  const h = Math.max(1, Math.round(box.bottom - box.top))
  const out = canvasOf(w, h)
  out.getContext('2d')!.drawImage(source, -Math.round(box.left), -Math.round(box.top))
  return out
}

function isFullyOpaque(canvas: HTMLCanvasElement): boolean {
  const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return false
  return true
}

function isEmpty(canvas: HTMLCanvasElement): boolean {
  const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 3; i < d.length; i += 4) if (d[i] > 3) return false
  return true
}

/**
 * The photo's shape: where the placeholder (or the layer it is clipped to)
 * is opaque, as white on transparent, cropped to the slot box.
 */
function photoMaskOf(psd: Psd, photo: PsdLayerLike, box: Box, warn: (w: PsdWarning) => void): HTMLCanvasElement | null {
  const base = clippingBase(psd as unknown as Parameters<typeof clippingBase>[0], photo)
  const pixels = pixelsOf((base ?? photo) as Layer, psd.width, psd.height, warn)
  if (!pixels) return null
  if (base) {
    // Clipped: the image shows where both the base and the placeholder itself are opaque.
    const own = pixelsOf(photo as Layer, psd.width, psd.height, warn)
    if (own) {
      const pctx = pixels.getContext('2d')!
      pctx.globalCompositeOperation = 'destination-in'
      pctx.drawImage(own, 0, 0)
    }
  }
  const mask = crop(pixels, box)
  if (isFullyOpaque(mask)) return null
  const mctx = mask.getContext('2d')!
  mctx.globalCompositeOperation = 'source-in'
  mctx.fillStyle = '#fff'
  mctx.fillRect(0, 0, mask.width, mask.height)
  return mask
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
    canvas = recomposite(
      psd,
      (l) => !skip.has(l),
      (w) => warnings.add(w)
    )
  }

  let background = await toBlob(canvas, 'image/png')
  if (background.size > MAX_BACKGROUND_BYTES) background = await toBlob(canvas, 'image/jpeg', 0.92)

  // Overlays: the background already shows them everywhere else, so the foreground
  // only needs the photo's area, where the photo would otherwise hide them.
  let foreground: Blob | null = null
  let photoMask: Blob | null = null
  const photo = plan.slotLayers.find((s) => s.kind === 'photo')?.layer
  const box = photo ? layerBox(photo) : null
  if (photo && box) {
    const { layers: above, blendSkipped } = foregroundLayers(
      psd as unknown as Parameters<typeof foregroundLayers>[0],
      plan
    )
    if (blendSkipped) warnings.add('overlayBlend')
    if (above.size > 0) {
      const fg = recomposite(
        psd,
        (l) => above.has(l),
        (w) => warnings.add(w)
      )
      const fctx = fg.getContext('2d')!
      fctx.globalCompositeOperation = 'destination-in'
      fctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top)
      if (!isEmpty(fg)) foreground = await toBlob(fg, 'image/png')
    }
    const mask = photoMaskOf(psd, photo, box, (w) => warnings.add(w))
    if (mask) photoMask = await toBlob(mask, 'image/png')
  }
  return { plan: { ...plan, warnings: [...warnings] }, background, foreground, photoMask }
}
