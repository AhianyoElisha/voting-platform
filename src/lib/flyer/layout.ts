/**
 * Pure geometry for rendering: how a photo fills a frame and how text shrinks
 * to fit. Both are driven by plain numbers (and an injected text measurer),
 * so they are tested without a canvas and behave identically in the browser
 * preview and the server renderer.
 */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Source rectangle of an image that covers `frame` (object-fit: cover).
 * `focusX` and `focusY` (0 to 1, default centre) choose which part survives
 * the crop along the axis that overflows, as CSS `object-position` does.
 */
export function coverCrop(
  imageW: number,
  imageH: number,
  frameW: number,
  frameH: number,
  focusX = 0.5,
  focusY = 0.5
): Rect {
  if (imageW <= 0 || imageH <= 0 || frameW <= 0 || frameH <= 0)
    return { x: 0, y: 0, w: Math.max(imageW, 0), h: Math.max(imageH, 0) }
  const scale = Math.max(frameW / imageW, frameH / imageH)
  const w = frameW / scale
  const h = frameH / scale
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5)
  return { x: (imageW - w) * clamp(focusX), y: (imageH - h) * clamp(focusY), w, h }
}

export type Measure = (text: string, fontSize: number) => number

export interface FitInput {
  text: string
  maxWidth: number
  maxHeight: number
  fontSize: number
  minFontSize: number
  maxLines: number
  /** Line height as a multiple of font size. */
  lineHeight?: number
}

export interface FitResult {
  fontSize: number
  lines: string[]
  /** True when the text had to be cut with an ellipsis at the minimum size. */
  truncated: boolean
}

/** Greedy word wrap at one size; words longer than the width are split by character. */
export function wrapLines(text: string, maxWidth: number, fontSize: number, measure: Measure): string[] {
  const words = text.split(' ').filter(Boolean)
  const lines: string[] = []
  let current = ''
  const push = () => {
    if (current) lines.push(current)
    current = ''
  }
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (measure(candidate, fontSize) <= maxWidth) {
      current = candidate
      continue
    }
    push()
    if (measure(word, fontSize) <= maxWidth) {
      current = word
      continue
    }
    let piece = ''
    for (const ch of word) {
      if (measure(piece + ch, fontSize) <= maxWidth) piece += ch
      else {
        if (piece) lines.push(piece)
        piece = ch
      }
    }
    current = piece
  }
  push()
  return lines
}

/**
 * Shrinks the font until the wrapped text fits the box in both width and
 * line count, never below `minFontSize`; at the floor, the last line is cut
 * with an ellipsis.
 */
export function fitText(input: FitInput, measure: Measure): FitResult {
  const lineHeight = input.lineHeight ?? 1.2
  const text = input.text.trim()
  if (!text) return { fontSize: input.fontSize, lines: [], truncated: false }
  const floor = Math.min(input.minFontSize, input.fontSize)
  for (let size = input.fontSize; size >= floor; size -= 1) {
    const lines = wrapLines(text, input.maxWidth, size, measure)
    const fitsLines = lines.length <= input.maxLines && lines.length * size * lineHeight <= input.maxHeight + 0.001
    const fitsWidth = lines.every((l) => measure(l, size) <= input.maxWidth)
    if (fitsLines && fitsWidth) return { fontSize: size, lines, truncated: false }
  }
  // At the floor: keep what fits and end with an ellipsis.
  const size = floor
  const maxByHeight = Math.max(1, Math.floor((input.maxHeight + 0.001) / (size * lineHeight)))
  const limit = Math.max(1, Math.min(input.maxLines, maxByHeight))
  const lines = wrapLines(text, input.maxWidth, size, measure).slice(0, limit)
  let last = lines[lines.length - 1] ?? ''
  const ellipsis = '…'
  while (last.length > 0 && measure(last + ellipsis, size) > input.maxWidth) last = last.slice(0, -1)
  lines[lines.length - 1] = (last.trimEnd() || '') + ellipsis
  return { fontSize: size, lines, truncated: true }
}
