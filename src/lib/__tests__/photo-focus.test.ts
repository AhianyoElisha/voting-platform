import { describe, expect, it } from 'vitest'
import { CENTRE, focusColumns, focusOf, isCentred, isDefault, parsePhotoFocus, sameFocus } from '../photo-focus'

describe('photo focus', () => {
  it('accepts a point in percent, with an optional zoom, and rounds them', () => {
    expect(parsePhotoFocus({ x: 30.4, y: 12.6 })).toEqual({ x: 30, y: 13, zoom: 100 })
    expect(parsePhotoFocus({ x: 0, y: 100, zoom: 149.6 })).toEqual({ x: 0, y: 100, zoom: 150 })
    expect(parsePhotoFocus({ x: 50, y: 50, zoom: 300 })).toEqual({ x: 50, y: 50, zoom: 300 })
  })

  it('refuses anything else', () => {
    for (const bad of [
      null,
      'top',
      5,
      {},
      { x: 50 },
      { x: -1, y: 50 },
      { x: 50, y: 101 },
      { x: '50', y: 50 },
      { x: NaN, y: 1 },
      { x: 50, y: 50, zoom: 99 },
      { x: 50, y: 50, zoom: 301 },
      { x: 50, y: 50, zoom: '200' },
      { x: 50, y: 50, zoom: null },
    ]) {
      expect(parsePhotoFocus(bad)).toBeNull()
    }
  })

  it('reads a row, treating unset or missing columns as the defaults', () => {
    expect(focusOf({})).toEqual(CENTRE)
    expect(focusOf({ photoFocusX: null, photoFocusY: null, photoZoom: null })).toEqual(CENTRE)
    expect(focusOf({ photoFocusX: 20, photoFocusY: null })).toEqual(CENTRE)
    expect(focusOf({ photoFocusX: 20, photoFocusY: 0 })).toEqual({ x: 20, y: 0, zoom: 100 })
    expect(focusOf({ photoZoom: 180 })).toEqual({ x: 50, y: 50, zoom: 180 })
    expect(focusOf({ photoZoom: 5000 })).toEqual(CENTRE)
  })

  it('stores the defaults as nulls and only touches the zoom column when it must', () => {
    expect(isCentred(CENTRE) && isDefault(CENTRE)).toBe(true)
    expect(isDefault({ x: 50, y: 50, zoom: 120 })).toBe(false)
    expect(sameFocus({ x: 1, y: 2, zoom: 100 }, { x: 1, y: 2, zoom: 110 })).toBe(false)
    // Never zoomed: the zoom column is not written at all.
    expect(focusColumns(CENTRE)).toEqual({ photoFocusX: null, photoFocusY: null })
    expect(focusColumns({ x: 50, y: 20, zoom: 100 })).toEqual({ photoFocusX: 50, photoFocusY: 20 })
    expect(focusColumns({ x: 50, y: 50, zoom: 150 })).toEqual({ photoFocusX: null, photoFocusY: null, photoZoom: 150 })
    // Back to 100 on a row that has a zoom: cleared.
    expect(focusColumns(CENTRE, { photoZoom: 150 })).toEqual({ photoFocusX: null, photoFocusY: null, photoZoom: null })
  })
})
