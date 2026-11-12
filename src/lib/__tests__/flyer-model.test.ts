import { describe, expect, test } from 'vitest'
import { SAMPLE_CONTEXT, resolveBinding, ussdInstruction } from '../flyer/bindings'
import { coverCrop, fitText, placePhoto, wrapLines } from '../flyer/layout'
import {
  EMPTY_MODEL,
  newPhotoSlot,
  newTextSlot,
  parseModel,
  photoFrameOf,
  validateModel,
  type SlotModel,
} from '../flyer/model'

const W = 1080
const H = 1920

function validModel(): SlotModel {
  return {
    version: 1,
    slots: [
      newPhotoSlot(W, H),
      { ...newTextSlot(W, H, 'nominee.name'), id: 't1' },
      { ...newTextSlot(W, H, 'ussd.instruction'), id: 't2' },
    ],
  }
}

describe('slot model', () => {
  test('a fresh model validates and round-trips', () => {
    const m = validModel()
    expect(validateModel(m, W, H)).toEqual([])
    expect(parseModel(JSON.stringify(m), W, H)).toEqual(m)
  })

  test('rejects junk, duplicates, two photos, bad bindings and colours', () => {
    expect(validateModel(null, W, H)).toEqual(['model must be an object'])
    expect(validateModel({ version: 2, slots: 'x' }, W, H)).toContain('slots must be an array')
    const m = validModel()
    m.slots.push({ ...newPhotoSlot(W, H), id: 'p2' })
    expect(validateModel(m, W, H)).toContain('at most one photo slot')
    const dup = validModel()
    dup.slots[2].id = 't1'
    expect(validateModel(dup, W, H).some((p) => p.includes('duplicate id'))).toBe(true)
    const bad = validModel()
    ;(bad.slots[1] as { binding: string }).binding = 'nominee.phone'
    ;(bad.slots[1] as { color: string }).color = 'red'
    const problems = validateModel(bad, W, H)
    expect(problems.some((p) => p.includes('unknown binding'))).toBe(true)
    expect(problems.some((p) => p.includes('color'))).toBe(true)
    const tiny = validModel()
    ;(tiny.slots[1] as { minFontSize: number }).minFontSize = 999
    expect(validateModel(tiny, W, H).some((p) => p.includes('minFontSize'))).toBe(true)
  })

  test('invalid stored JSON falls back to the empty model', () => {
    expect(parseModel('nope', W, H)).toEqual(EMPTY_MODEL)
    expect(parseModel(JSON.stringify({ version: 1, slots: [{ type: 'text' }] }), W, H)).toEqual(EMPTY_MODEL)
    expect(parseModel(null, W, H)).toEqual(EMPTY_MODEL)
  })
})

describe('bindings', () => {
  test('resolve each binding, uppercase and whitespace', () => {
    const ctx = { ...SAMPLE_CONTEXT, nomineeName: '  Ama   Owusu ', ussdShortcode: '*713*42#' }
    expect(resolveBinding({ binding: 'nominee.name', text: '', uppercase: false }, ctx)).toBe('Ama Owusu')
    expect(resolveBinding({ binding: 'nominee.name', text: '', uppercase: true }, ctx)).toBe('AMA OWUSU')
    expect(resolveBinding({ binding: 'nominee.code', text: '', uppercase: false }, ctx)).toBe('4321')
    expect(resolveBinding({ binding: 'category.name', text: '', uppercase: false }, ctx)).toBe('Miss Social Science')
    expect(resolveBinding({ binding: 'event.title', text: '', uppercase: false }, ctx)).toBe('Faculty Awards 2026')
    expect(resolveBinding({ binding: 'ussd.instruction', text: '', uppercase: false }, ctx)).toBe(
      'Dial *713*42#, enter 4321'
    )
    expect(resolveBinding({ binding: 'custom', text: 'Vote now', uppercase: false }, ctx)).toBe('Vote now')
  })

  test('USSD instruction shows a placeholder until the shortcode exists', () => {
    expect(ussdInstruction('4321', null)).toBe('Dial *XXX*YY#, enter 4321')
    expect(ussdInstruction('4321', '  ')).toBe('Dial *XXX*YY#, enter 4321')
  })
})

describe('photo fit on the slot', () => {
  test('fit is optional, cover or contain, and anything else is refused', () => {
    const withFit = (fit: unknown) => ({
      version: 1,
      slots: [{ ...newPhotoSlot(W, H), ...(fit === undefined ? {} : { fit }) }],
    })
    expect(validateModel(withFit(undefined), W, H)).toEqual([])
    expect(validateModel(withFit('cover'), W, H)).toEqual([])
    expect(validateModel(withFit('contain'), W, H)).toEqual([])
    expect(validateModel(withFit('stretch'), W, H)).toEqual(['slot 0: fit must be cover or contain'])
  })

  test('photoFrameOf reads the frame shape and fit, defaulting to cover', () => {
    const slot = { ...newPhotoSlot(W, H), w: 400, h: 500 }
    expect(photoFrameOf(JSON.stringify({ version: 1, slots: [slot] }), W, H)).toEqual({ aspect: 0.8, fit: 'cover' })
    expect(photoFrameOf(JSON.stringify({ version: 1, slots: [{ ...slot, fit: 'contain' }] }), W, H)).toEqual({
      aspect: 0.8,
      fit: 'contain',
    })
    expect(photoFrameOf(JSON.stringify(EMPTY_MODEL), W, H)).toBeNull()
    expect(photoFrameOf(null, W, H)).toBeNull()
  })
})

describe('layout', () => {
  test('coverCrop centres the largest matching-aspect region', () => {
    expect(coverCrop(2000, 1000, 500, 500)).toEqual({ x: 500, y: 0, w: 1000, h: 1000 })
    expect(coverCrop(1000, 2000, 500, 500)).toEqual({ x: 0, y: 500, w: 1000, h: 1000 })
    expect(coverCrop(800, 600, 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 })
    expect(coverCrop(0, 0, 10, 10)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })

  test('coverCrop follows the focus along the axis that overflows', () => {
    // Portrait photo in a square frame: only the vertical position can move.
    expect(coverCrop(1000, 2000, 500, 500, 0.5, 0)).toEqual({ x: 0, y: 0, w: 1000, h: 1000 })
    expect(coverCrop(1000, 2000, 500, 500, 0.5, 1)).toEqual({ x: 0, y: 1000, w: 1000, h: 1000 })
    expect(coverCrop(1000, 2000, 500, 500, 0, 0.25)).toEqual({ x: 0, y: 250, w: 1000, h: 1000 })
    // Out-of-range or broken values never leave the photo.
    expect(coverCrop(2000, 1000, 500, 500, 7, -3)).toEqual({ x: 1000, y: 0, w: 1000, h: 1000 })
    expect(coverCrop(2000, 1000, 500, 500, NaN, 0.5)).toEqual({ x: 500, y: 0, w: 1000, h: 1000 })
  })

  test('placePhoto with the defaults is coverCrop filling the frame', () => {
    expect(placePhoto(2000, 1000, 500, 500)).toEqual({
      src: coverCrop(2000, 1000, 500, 500),
      dst: { x: 0, y: 0, w: 500, h: 500 },
    })
    expect(placePhoto(1000, 2000, 500, 500, { focusX: 0.5, focusY: 0 }).src).toEqual(
      coverCrop(1000, 2000, 500, 500, 0.5, 0)
    )
  })

  test('placePhoto: zoom gives a same-shape photo room to move', () => {
    // Square photo, square frame: at 100% the focus changes nothing.
    expect(placePhoto(1000, 1000, 500, 500, { focusX: 0, focusY: 0 }).src).toEqual({ x: 0, y: 0, w: 1000, h: 1000 })
    // At 200% half the photo is visible and the focus picks which half.
    expect(placePhoto(1000, 1000, 500, 500, { zoom: 2, focusX: 0.5, focusY: 0 })).toEqual({
      src: { x: 250, y: 0, w: 500, h: 500 },
      dst: { x: 0, y: 0, w: 500, h: 500 },
    })
    expect(placePhoto(1000, 1000, 500, 500, { zoom: 2, focusX: 1, focusY: 1 }).src).toEqual({
      x: 500,
      y: 500,
      w: 500,
      h: 500,
    })
    // A zoom below 1 or a broken one never shrinks the photo.
    expect(placePhoto(1000, 1000, 500, 500, { zoom: 0.2 }).src).toEqual({ x: 0, y: 0, w: 1000, h: 1000 })
    expect(placePhoto(1000, 1000, 500, 500, { zoom: NaN }).src).toEqual({ x: 0, y: 0, w: 1000, h: 1000 })
  })

  test('placePhoto: contain shows the whole photo, centred, and crops only once zoom overflows', () => {
    // Portrait photo in a square frame: full photo, bars left and right.
    expect(placePhoto(1000, 2000, 500, 500, { fit: 'contain', focusY: 0 })).toEqual({
      src: { x: 0, y: 0, w: 1000, h: 2000 },
      dst: { x: 125, y: 0, w: 250, h: 500 },
    })
    // Zoomed 2x it fills the width exactly and overflows the height, cropped at the focus.
    expect(placePhoto(1000, 2000, 500, 500, { fit: 'contain', zoom: 2, focusY: 0 })).toEqual({
      src: { x: 0, y: 0, w: 1000, h: 1000 },
      dst: { x: 0, y: 0, w: 500, h: 500 },
    })
    expect(placePhoto(0, 0, 10, 10).dst).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })

  // 0.6em per character: a predictable stand-in for a real font.
  const measure = (text: string, size: number) => text.length * size * 0.6

  test('wrapLines wraps on words and splits long words', () => {
    expect(wrapLines('Ama Owusu Mensah', 60, 10, measure)).toEqual(['Ama Owusu', 'Mensah'])
    expect(wrapLines('Supercalifragilistic', 60, 10, measure)).toEqual(['Supercalif', 'ragilistic'])
    expect(wrapLines('', 60, 10, measure)).toEqual([])
  })

  test('fitText keeps the size when it fits, shrinks when it does not, truncates at the floor', () => {
    expect(
      fitText({ text: 'Ama', maxWidth: 100, maxHeight: 50, fontSize: 40, minFontSize: 12, maxLines: 1 }, measure)
    ).toEqual({
      fontSize: 40,
      lines: ['Ama'],
      truncated: false,
    })
    // 16 characters at 0.6em need size <= 10.4 to fit 100px on one line.
    const shrunk = fitText(
      { text: 'Ama Owusu Mensah', maxWidth: 100, maxHeight: 50, fontSize: 40, minFontSize: 8, maxLines: 1 },
      measure
    )
    expect(shrunk.truncated).toBe(false)
    expect(shrunk.lines).toEqual(['Ama Owusu Mensah'])
    expect(shrunk.fontSize).toBeLessThan(40)
    expect(measure(shrunk.lines[0], shrunk.fontSize)).toBeLessThanOrEqual(100)

    const cut = fitText(
      {
        text: 'A very long nominee name that cannot fit anywhere',
        maxWidth: 60,
        maxHeight: 20,
        fontSize: 30,
        minFontSize: 14,
        maxLines: 1,
      },
      measure
    )
    expect(cut.truncated).toBe(true)
    expect(cut.fontSize).toBe(14)
    expect(cut.lines).toHaveLength(1)
    expect(cut.lines[0].endsWith('…')).toBe(true)
    expect(measure(cut.lines[0], 14)).toBeLessThanOrEqual(60)
  })

  test('fitText uses extra lines before shrinking', () => {
    // 'Ama Owusu' is 108px wide at 20px, but 'Ama' and 'Owusu' fit on two lines at full size.
    const two = fitText(
      { text: 'Ama Owusu', maxWidth: 70, maxHeight: 60, fontSize: 20, minFontSize: 10, maxLines: 2 },
      measure
    )
    expect(two).toEqual({ fontSize: 20, lines: ['Ama', 'Owusu'], truncated: false })
    // With one line allowed it must shrink instead.
    const one = fitText(
      { text: 'Ama Owusu', maxWidth: 70, maxHeight: 60, fontSize: 20, minFontSize: 10, maxLines: 1 },
      measure
    )
    expect(one.lines).toEqual(['Ama Owusu'])
    expect(one.fontSize).toBe(12)
  })
})
