/**
 * How a nominee's photo sits in a flyer's photo frame (FLYER_ENGINE.md,
 * "Photo position"): a point on the photo and a zoom.
 *
 * `x` and `y` are a point in percent from the photo's top-left corner. When
 * the photo is larger than the frame along an axis, the crop keeps that point
 * as close to the same place in the frame as the photo's edges allow, exactly
 * like CSS `object-position`. `zoom` (percent, 100 to 300) enlarges the photo
 * beyond the size the template's fit gives it, which is what makes the point
 * matter when the photo and the frame have the same shape.
 *
 * Centre at 100% is the default and is stored as nulls.
 */
export interface PhotoFocus {
  x: number
  y: number
  zoom: number
}

export const ZOOM_MIN = 100
export const ZOOM_MAX = 300
export const CENTRE: PhotoFocus = { x: 50, y: 50, zoom: 100 }

const between = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max
const inRange = (n: unknown): n is number => between(n, 0, 100)

/** A focus from untrusted input, rounded to whole percent; null when it is not one. Zoom is optional. */
export function parsePhotoFocus(input: unknown): PhotoFocus | null {
  if (!input || typeof input !== 'object') return null
  const { x, y, zoom } = input as Record<string, unknown>
  if (!inRange(x) || !inRange(y)) return null
  if (zoom !== undefined && !between(zoom, ZOOM_MIN, ZOOM_MAX)) return null
  return { x: Math.round(x), y: Math.round(y), zoom: zoom === undefined ? 100 : Math.round(zoom) }
}

type FocusRow = { photoFocusX?: number | null; photoFocusY?: number | null; photoZoom?: number | null }

/** The focus stored on a nominee row; defaults where unset (or where the columns are absent). */
export function focusOf(row: FocusRow): PhotoFocus {
  const placed = inRange(row.photoFocusX) && inRange(row.photoFocusY)
  return {
    x: placed ? (row.photoFocusX as number) : 50,
    y: placed ? (row.photoFocusY as number) : 50,
    zoom: between(row.photoZoom, ZOOM_MIN, ZOOM_MAX) ? row.photoZoom : 100,
  }
}

export function isCentred(focus: PhotoFocus): boolean {
  return focus.x === 50 && focus.y === 50
}

/** True when the photo is exactly as an untouched one: centred, not zoomed. */
export function isDefault(focus: PhotoFocus): boolean {
  return isCentred(focus) && focus.zoom === 100
}

export function sameFocus(a: PhotoFocus, b: PhotoFocus): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom
}

/**
 * Column values for a focus: nulls for the defaults, so an untouched photo
 * stays as it was. `photoZoom` is only written when there is a zoom to store
 * or one to clear on `current`, so rows nobody zoomed are never sent it.
 */
export function focusColumns(focus: PhotoFocus, current: FocusRow = {}): FocusRow {
  const columns: FocusRow = isCentred(focus)
    ? { photoFocusX: null, photoFocusY: null }
    : { photoFocusX: focus.x, photoFocusY: focus.y }
  if (focus.zoom !== 100) columns.photoZoom = focus.zoom
  else if (typeof current.photoZoom === 'number') columns.photoZoom = null
  return columns
}
