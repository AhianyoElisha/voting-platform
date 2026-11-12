import { describe, expect, it } from 'vitest'
import { validateModel, type TextSlot } from '../flyer/model'
import {
  alignOf,
  bezierSegments,
  buildSlots,
  colorOf,
  layerBox,
  placeholderOf,
  planPsd,
  roomInside,
  type PsdLike,
} from '../flyer/psd-plan'

const nameLayer = {
  name: '{{name}}',
  left: 400,
  top: 900,
  right: 680,
  bottom: 980,
  text: {
    text: '{{name}}',
    transform: [2, 0, 0, 2, 540, 970],
    style: { font: { name: 'Montserrat-Bold' }, fontSize: 36, fillColor: { r: 255, g: 204, b: 0 }, fontCaps: 2 },
    paragraphStyle: { justification: 'center' },
  },
}

function psd(extra: Partial<PsdLike> = {}): PsdLike {
  return {
    width: 1080,
    height: 1920,
    children: [
      { name: 'Background' },
      { name: 'Title', text: { text: 'Miss Social Science', style: { font: { name: 'PlayfairDisplay-Black' } } } },
      { name: '{{photo:round}}', left: 240, top: 200, right: 840, bottom: 800 },
      { name: 'Slots', children: [nameLayer] },
      {
        name: 'Code text',
        left: 100,
        top: 1600,
        right: 900,
        bottom: 1700,
        text: {
          text: '{{code}}',
          transform: [1, 0, 0, 1, 100, 1600],
          style: { font: { name: 'Montserrat-Regular' }, fontSize: 40 },
          shapeType: 'box',
          boxBounds: [0, 0, 800, 100],
          paragraphStyle: { justification: 'left' },
        },
      },
    ],
    ...extra,
  }
}

describe('placeholderOf', () => {
  it('reads layer names and text, with spacing and case tolerated', () => {
    expect(placeholderOf({ name: '{{ Name }}' })).toEqual({ kind: 'nominee.name', round: false })
    expect(placeholderOf({ name: 'Layer 7', text: { text: '{{ussd}}' } })).toEqual({
      kind: 'ussd.instruction',
      round: false,
    })
    expect(placeholderOf({ name: '{{photo:circle}}' })).toEqual({ kind: 'photo', round: true })
    expect(placeholderOf({ name: '{{photo}}' })).toEqual({ kind: 'photo', round: false })
    expect(placeholderOf({ name: '{{price}}' })).toBeNull()
    expect(placeholderOf({ name: 'Vote {{name}} now' })).toBeNull()
  })
})

describe('planPsd', () => {
  it('finds the slots inside groups and only the slot fonts need installing', () => {
    const plan = planPsd(psd())
    expect(plan.slotLayers.map((s) => s.kind)).toEqual(['photo', 'nominee.name', 'nominee.code'])
    expect(plan.slotFonts.sort()).toEqual(['Montserrat-Bold', 'Montserrat-Regular'])
    expect(plan.designFonts).toContain('PlayfairDisplay-Black')
    expect(plan.exactBackground).toBe(false)
    expect(plan.warnings).toContain('slotsVisible')
  })

  it('uses the flattened image when every placeholder is hidden (here via a hidden group)', () => {
    const p = psd()
    p.children = p.children!.map((l) =>
      l.name === 'Slots' || l.name?.startsWith('{{') || l.name === 'Code text' ? { ...l, hidden: true } : l
    )
    const plan = planPsd(p)
    expect(plan.exactBackground).toBe(true)
    expect(plan.warnings).not.toContain('slotsVisible')
  })

  it('warns when there is nothing to fill, or a second photo', () => {
    expect(planPsd({ width: 10, height: 10, children: [{ name: 'Art' }] }).warnings).toContain('noSlots')
    const two = planPsd({ width: 10, height: 10, children: [{ name: '{{photo}}' }, { name: '{{photo}}' }] })
    expect(two.slotLayers).toHaveLength(1)
    expect(two.warnings).toContain('duplicatePhoto')
  })

  it('ignores a text placeholder that is not a text layer', () => {
    expect(planPsd({ width: 10, height: 10, children: [{ name: '{{name}}' }] }).slotLayers).toHaveLength(0)
  })
})

describe('buildSlots', () => {
  const fonts = [
    { postScriptName: 'Montserrat-Bold', family: 'Montserrat', weight: 700, italic: false },
    { postScriptName: 'Montserrat-Regular', family: 'Montserrat', weight: 400, italic: false },
  ]

  it('produces a model the server accepts', () => {
    const slots = buildSlots(planPsd(psd()), fonts, 1)
    expect(validateModel({ version: 1, slots }, 1080, 1920)).toEqual([])
  })

  it('carries over font, size (with the layer transform), colour, alignment and caps', () => {
    const name = buildSlots(planPsd(psd()), fonts, 1).find(
      (s) => s.type === 'text' && s.binding === 'nominee.name'
    ) as TextSlot
    expect(name).toMatchObject({
      fontFamily: 'Montserrat',
      fontWeight: 700,
      fontSize: 72,
      minFontSize: 36,
      color: '#ffcc00',
      align: 'center',
      uppercase: true,
      maxLines: 1,
      rotation: 0,
    })
    // Point text widens around its centre (540) to 60% of the width.
    expect(name.w).toBe(648)
    expect(name.x + name.w / 2).toBe(540)
  })

  it('keeps a paragraph box and derives its line count', () => {
    const code = buildSlots(planPsd(psd()), fonts, 1).find(
      (s) => s.type === 'text' && s.binding === 'nominee.code'
    ) as TextSlot
    expect(code).toMatchObject({ x: 100, y: 1600, w: 800, h: 100, align: 'left', maxLines: 2, fontWeight: 400 })
  })

  it('scales everything to the stored background and makes the round photo an ellipse', () => {
    const slots = buildSlots(planPsd(psd()), fonts, 0.5)
    expect(slots[0]).toMatchObject({ type: 'photo', shape: 'ellipse', x: 120, y: 100, w: 300, h: 300 })
    expect((slots[1] as TextSlot).fontSize).toBe(36)
  })

  it('places point text from its anchor when the layer has no pixel bounds', () => {
    const plan = planPsd({
      width: 1080,
      height: 1350,
      children: [
        {
          name: '{{name}}',
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          text: {
            text: '{{name}}',
            transform: [1, 0, 0, 1, 540, 940],
            style: { fontSize: 64 },
            paragraphStyle: { justification: 'center' },
          },
        },
      ],
    })
    const slot = buildSlots(plan, [], 1)[0] as TextSlot
    expect(slot.x + slot.w / 2).toBe(540)
    // Vertically around the text: baseline 940, cap height above it.
    expect(slot.y).toBeLessThan(940)
    expect(slot.y + slot.h).toBeGreaterThan(900)
  })

  it('falls back to the built-in font when a font is unknown', () => {
    const slot = buildSlots(planPsd(psd()), [], 1)[1] as TextSlot
    expect(slot.fontFamily).toBe('Poppins')
  })
})

describe('style helpers', () => {
  it('reads both colour encodings', () => {
    expect(colorOf({ fillColor: { r: 0, g: 128, b: 255 } })).toBe('#0080ff')
    expect(colorOf({ fillColor: { fr: 1, fg: 0, fb: 0.5 } })).toBe('#ff0080')
    expect(colorOf({})).toBe('#000000')
  })

  it('maps justification', () => {
    expect(alignOf('justify-right')).toBe('right')
    expect(alignOf('justify-all')).toBe('center')
    expect(alignOf(undefined)).toBe('left')
  })
})

describe('bezierSegments', () => {
  it('turns a closed rounded rectangle path into curves back to the start', () => {
    // From a real shape layer: 40 px top corners, square bottom.
    const knots = [
      [1170, 1458, 1192, 1458, 1192, 1458],
      [1660, 1458, 1660, 1458, 1682, 1458],
      [1700, 1476, 1700, 1498, 1700, 1498],
      [1700, 2000, 1700, 2000, 1700, 2000],
      [1152, 2000, 1152, 2000, 1152, 2000],
      [1152, 1498, 1152, 1498, 1152, 1476],
    ].map((points) => ({ points }))
    const segs = bezierSegments({ open: false, knots })
    expect(segs[0]).toEqual({ op: 'move', x: 1192, y: 1458 })
    expect(segs).toHaveLength(1 + 6 + 1)
    expect(segs[2]).toEqual({ op: 'curve', c1x: 1682, c1y: 1458, c2x: 1700, c2y: 1476, x: 1700, y: 1498 })
    expect(segs[6]).toEqual({ op: 'curve', c1x: 1152, c1y: 1476, c2x: 1170, c2y: 1458, x: 1192, y: 1458 })
    expect(segs[7]).toEqual({ op: 'close' })
  })

  it('leaves an open path open and ignores malformed knots', () => {
    const segs = bezierSegments({
      open: true,
      knots: [{ points: [0, 0, 0, 0, 0, 0] }, { points: [1] }, { points: [5, 5, 5, 5, 5, 5] }],
    })
    expect(segs.map((s) => s.op)).toEqual(['move', 'curve'])
  })
})

describe('placeholders inside a shape', () => {
  // The real KNUST flyer: a rounded box drawn as a vector shape (no pixels), with
  // left-aligned point text {{name}} inside it, 55 px from the box's left edge.
  const box = {
    name: 'Rectangle',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    vectorMask: {
      paths: [
        {
          knots: [
            [1170, 1458, 1192, 1458, 1192, 1458],
            [1660, 1458, 1660, 1458, 1682, 1458],
            [1700, 1476, 1700, 1498, 1700, 1498],
            [1700, 2000, 1700, 2000, 1700, 2000],
            [1152, 2000, 1152, 2000, 1152, 2000],
            [1152, 1498, 1152, 1498, 1152, 1476],
          ].map((points) => ({ points })),
        },
      ],
    },
  }
  const name = {
    name: '{{name}}',
    left: 1207,
    top: 1567,
    right: 1448,
    bottom: 1640,
    text: {
      text: 'KNUST',
      transform: [2, 0, 0, 2, 1207, 1630],
      style: { fontSize: 38 },
      paragraphStyle: { justification: 'left' },
    },
  }

  it('reads a shape layer extent from its outline', () => {
    expect(layerBox(box)).toEqual({ left: 1152, top: 1458, right: 1700, bottom: 2000 })
    expect(layerBox({ name: 'empty' })).toBeNull()
  })

  it('keeps the slot inside the box with the same margin on both sides', () => {
    const plan = planPsd({
      width: 2000,
      height: 2000,
      children: [{ name: 'Background', left: 0, top: 0, right: 2000, bottom: 2000 }, box, name],
    })
    expect(plan.containers).toEqual([{ left: 1152, top: 1458, right: 1700, bottom: 2000 }])
    const slot = buildSlots(plan, [], 1)[0] as TextSlot
    expect(slot.x).toBe(1207)
    expect(slot.x + slot.w).toBe(1700 - 55)
  })

  it('centres and right-aligns within the box too', () => {
    const c = [{ left: 100, top: 0, right: 500, bottom: 100 }]
    const t = { left: 250, top: 10, right: 350, bottom: 50 }
    expect(roomInside(c, t, 'center')).toEqual({ x: 250, w: 100 })
    expect(roomInside(c, { ...t, left: 120, right: 200 }, 'center')).toEqual({ x: 120, w: 360 })
    expect(roomInside(c, { ...t, left: 300, right: 480 }, 'right')).toEqual({ x: 120, w: 360 })
    expect(roomInside(c, { ...t, left: 600, right: 700 }, 'left')).toBeNull()
  })
})
