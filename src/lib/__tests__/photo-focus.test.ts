import { describe, expect, it } from 'vitest'
import { CENTRE, focusColumns, focusOf, isCentred, parsePhotoFocus } from '../photo-focus'

describe('photo focus', () => {
  it('accepts a point in percent and rounds it', () => {
    expect(parsePhotoFocus({ x: 30.4, y: 12.6 })).toEqual({ x: 30, y: 13 })
    expect(parsePhotoFocus({ x: 0, y: 100 })).toEqual({ x: 0, y: 100 })
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
    ]) {
      expect(parsePhotoFocus(bad)).toBeNull()
    }
  })

  it('reads a row, treating unset or missing columns as centre', () => {
    expect(focusOf({})).toEqual(CENTRE)
    expect(focusOf({ photoFocusX: null, photoFocusY: null })).toEqual(CENTRE)
    expect(focusOf({ photoFocusX: 20, photoFocusY: null })).toEqual(CENTRE)
    expect(focusOf({ photoFocusX: 20, photoFocusY: 0 })).toEqual({ x: 20, y: 0 })
  })

  it('stores centre as nulls', () => {
    expect(isCentred(CENTRE)).toBe(true)
    expect(focusColumns(CENTRE)).toEqual({ photoFocusX: null, photoFocusY: null })
    expect(focusColumns({ x: 50, y: 20 })).toEqual({ photoFocusX: 50, photoFocusY: 20 })
  })
})
