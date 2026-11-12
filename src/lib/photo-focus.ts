/**
 * Where a nominee's photo is anchored when it is cropped to fill a flyer's
 * photo frame (FLYER_ENGINE.md, "crop and position adjustment per nominee").
 * A point on the photo, in percent from its top-left corner: the crop keeps
 * that point as close to the same place in the frame as the photo's edges
 * allow, exactly like CSS `object-position`. Centre (50, 50) is the default
 * and is stored as nulls.
 */
export interface PhotoFocus {
  x: number
  y: number
}

export const CENTRE: PhotoFocus = { x: 50, y: 50 }

const inRange = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100

/** A focus from untrusted input, rounded to whole percent; null when it is not one. */
export function parsePhotoFocus(input: unknown): PhotoFocus | null {
  if (!input || typeof input !== 'object') return null
  const { x, y } = input as Record<string, unknown>
  return inRange(x) && inRange(y) ? { x: Math.round(x), y: Math.round(y) } : null
}

/** The focus stored on a nominee row; centre when unset (or the columns are absent). */
export function focusOf(row: { photoFocusX?: number | null; photoFocusY?: number | null }): PhotoFocus {
  return inRange(row.photoFocusX) && inRange(row.photoFocusY) ? { x: row.photoFocusX, y: row.photoFocusY } : CENTRE
}

export function isCentred(focus: PhotoFocus): boolean {
  return focus.x === 50 && focus.y === 50
}

/** Column values for a focus: nulls for centre, so an untouched photo stays as it was. */
export function focusColumns(focus: PhotoFocus): { photoFocusX: number | null; photoFocusY: number | null } {
  return isCentred(focus) ? { photoFocusX: null, photoFocusY: null } : { photoFocusX: focus.x, photoFocusY: focus.y }
}
