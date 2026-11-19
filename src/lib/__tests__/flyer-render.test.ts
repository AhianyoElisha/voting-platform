import { createCanvas, loadImage } from '@napi-rs/canvas'
import { existsSync } from 'fs'
import { describe, expect, test } from 'vitest'
import { FALLBACK_FONT, newPhotoSlot, newTextSlot, type SlotModel } from '../flyer/model'
import { builtinFonts, renderFlyer, solidPng } from '../flyer/render'

async function pixelAt(png: Uint8Array, x: number, y: number): Promise<[number, number, number, number]> {
  const img = await loadImage(Buffer.from(png))
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2], d[3]]
}

describe('renderFlyer', () => {
  test('produces a PNG of the template size with the photo and text drawn where the slots are', async () => {
    const W = 300
    const H = 400
    const photoSlot = {
      ...newPhotoSlot(W, H),
      id: 'p',
      x: 50,
      y: 50,
      w: 100,
      h: 100,
      shape: 'rect' as const,
      radius: 0,
    }
    const nameSlot = {
      ...newTextSlot(W, H, 'nominee.name'),
      id: 't',
      x: 0,
      y: 300,
      w: W,
      h: 60,
      fontSize: 40,
      minFontSize: 10,
      color: '#ff0000',
    }
    const model: SlotModel = { version: 1, slots: [photoSlot, nameSlot] }

    const png = await renderFlyer({
      width: W,
      height: H,
      background: solidPng(600, 800, '#0000ff'),
      photo: solidPng(50, 80, '#00ff00'),
      model,
      context: {
        nomineeName: 'Ama Owusu',
        nomineeCode: '4321',
        categoryName: 'C',
        eventTitle: 'E',
        ussdShortcode: null,
      },
      fonts: [],
    })

    const img = await loadImage(Buffer.from(png))
    expect([img.width, img.height]).toEqual([W, H])
    // Background where nothing else is drawn.
    expect(await pixelAt(png, 5, 5)).toEqual([0, 0, 255, 255])
    // Photo covers its slot.
    expect(await pixelAt(png, 100, 100)).toEqual([0, 255, 0, 255])
    // Some red text pixels exist inside the text box, none above it.
    let red = 0
    const bigImg = await loadImage(Buffer.from(png))
    const c = createCanvas(W, H)
    const ctx = c.getContext('2d')
    ctx.drawImage(bigImg, 0, 0)
    const box = ctx.getImageData(0, 300, W, 60).data
    for (let i = 0; i < box.length; i += 4) if (box[i] > 200 && box[i + 1] < 80 && box[i + 2] < 80) red += 1
    expect(red).toBeGreaterThan(50)
    const above = ctx.getImageData(0, 200, W, 60).data
    let redAbove = 0
    for (let i = 0; i < above.length; i += 4) if (above[i] > 200 && above[i + 1] < 80) redAbove += 1
    expect(redAbove).toBe(0)
  })

  test('renders without a background or photo, and ellipse photo slots clip the corners', async () => {
    const W = 200
    const H = 200
    const slot = { ...newPhotoSlot(W, H), id: 'p', x: 50, y: 50, w: 100, h: 100, shape: 'ellipse' as const }
    const png = await renderFlyer({
      width: W,
      height: H,
      background: null,
      photo: solidPng(10, 10, '#00ff00'),
      model: { version: 1, slots: [slot] },
      context: { nomineeName: 'A', nomineeCode: '1', categoryName: '', eventTitle: '', ussdShortcode: null },
      fonts: [],
    })
    expect(await pixelAt(png, 100, 100)).toEqual([0, 255, 0, 255])
    // The slot's corner is outside the ellipse: background shows through.
    const corner = await pixelAt(png, 52, 52)
    expect(corner[1]).toBeLessThan(100)
  })

  test('ships the default font (Poppins) in every weight, so flyers match the editor without an upload', async () => {
    for (const f of builtinFonts()) expect(existsSync(f.path), f.path).toBe(true)

    // Ink coverage of the same text at increasing weights. With only the host's
    // sans-serif fallback, 300 and 400 render identically (it has two faces).
    const inkAt = async (fontWeight: number) => {
      const W = 600
      const H = 160
      const slot = { ...newTextSlot(W, H, 'nominee.name'), id: 't', x: 0, y: 0, w: W, h: H, fontWeight, fontSize: 90 }
      expect(slot.fontFamily).toBe(FALLBACK_FONT)
      const png = await renderFlyer({
        width: W,
        height: H,
        background: solidPng(1, 1, '#ffffff'),
        photo: null,
        // A white-on-white privacy slot keeps the fallback band (decision #28) out of the ink count.
        model: {
          version: 1,
          slots: [
            { ...slot, color: '#000000' },
            { ...newTextSlot(W, H, 'privacy.notice'), id: 'pv', color: '#ffffff' },
          ],
        },
        context: { nomineeName: 'Hgx', nomineeCode: '1', categoryName: '', eventTitle: '', ussdShortcode: null },
        fonts: [],
      })
      const img = await loadImage(Buffer.from(png))
      const ctx = createCanvas(W, H).getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, W, H).data
      let ink = 0
      for (let i = 0; i < d.length; i += 4) ink += 255 - d[i]
      return ink
    }
    const [light, regular, black] = [await inkAt(300), await inkAt(400), await inkAt(900)]
    expect(regular).toBeGreaterThan(light * 1.1)
    expect(black).toBeGreaterThan(regular * 1.5)
  })
})

/** A PNG of the given size: transparent except an opaque rectangle of `color`. */
function overlayPng(width: number, height: number, rect: [number, number, number, number], color: string): Uint8Array {
  const c = createCanvas(width, height)
  const ctx = c.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(...rect)
  return new Uint8Array(c.toBuffer('image/png'))
}

describe('foreground and photo mask (PSD import)', () => {
  const W = 200
  const H = 200
  const photoSlot = { ...newPhotoSlot(W, H), id: 'p', x: 50, y: 50, w: 100, h: 100, rotation: 0, radius: 0 }
  const name = {
    ...newTextSlot(W, H, 'nominee.name'),
    id: 't',
    x: 0,
    y: 50,
    w: W,
    h: 40,
    fontSize: 30,
    minFontSize: 10,
    color: '#ffffff',
  }
  const base = {
    width: W,
    height: H,
    background: solidPng(W, H, '#0000ff'),
    photo: solidPng(10, 10, '#00ff00'),
    context: { nomineeName: 'WWWWWWWWWW', nomineeCode: '1', categoryName: '', eventTitle: '', ussdShortcode: null },
    fonts: builtinFonts(),
  }

  test('the foreground covers the photo, and text after the photo slot stays above it', async () => {
    // Red overlay over the whole photo area; transparent elsewhere.
    const foreground = overlayPng(W, H, [50, 50, 100, 100], '#ff0000')
    const png = await renderFlyer({
      ...base,
      foreground,
      model: { version: 1, slots: [{ ...photoSlot, shape: 'rect' }, name] },
    })
    expect(await pixelAt(png, 140, 140)).toEqual([255, 0, 0, 255]) // overlay over photo
    expect(await pixelAt(png, 10, 10)).toEqual([0, 0, 255, 255]) // background where the overlay is transparent
    // White text is drawn over the red overlay.
    const img = await loadImage(Buffer.from(png))
    const c = createCanvas(W, H)
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const band = ctx.getImageData(50, 50, 100, 40).data
    let white = 0
    for (let i = 0; i < band.length; i += 4) if (band[i] > 240 && band[i + 1] > 240 && band[i + 2] > 240) white += 1
    expect(white).toBeGreaterThan(20)
  })

  test('a mask cuts the photo to its opaque area', async () => {
    // Mask: only the left half of the slot is opaque.
    const photoMask = overlayPng(100, 100, [0, 0, 50, 100], '#ffffff')
    const png = await renderFlyer({
      ...base,
      photoMask,
      model: { version: 1, slots: [{ ...photoSlot, shape: 'mask' }] },
    })
    expect(await pixelAt(png, 70, 100)).toEqual([0, 255, 0, 255]) // left half: photo
    expect(await pixelAt(png, 130, 100)).toEqual([0, 0, 255, 255]) // right half: background shows through
  })

  test('without a mask image, the mask shape is a rectangle', async () => {
    const png = await renderFlyer({ ...base, model: { version: 1, slots: [{ ...photoSlot, shape: 'mask' }] } })
    expect(await pixelAt(png, 130, 100)).toEqual([0, 255, 0, 255])
  })

  test('with no photo slot the foreground still draws, under the text', async () => {
    const foreground = overlayPng(W, H, [0, 0, W, H], '#ff0000')
    const png = await renderFlyer({ ...base, foreground, model: { version: 1, slots: [name] } })
    // Above the privacy band along the bottom edge (decision #28).
    expect(await pixelAt(png, 5, 150)).toEqual([255, 0, 0, 255])
  })
})

describe('privacy notice (decision #28)', () => {
  const W = 300
  const H = 400
  const context = {
    nomineeName: 'Ama Owusu',
    nomineeCode: '4321',
    categoryName: 'C',
    eventTitle: 'E',
    ussdShortcode: null,
    appUrl: 'https://voteapp.example',
  }
  const render = (model: SlotModel) =>
    renderFlyer({ width: W, height: H, background: solidPng(W, H, '#ffffff'), photo: null, model, context, fonts: [] })

  test('a template without a privacy slot gets a dark band with the notice along the bottom', async () => {
    const png = await render({ version: 1, slots: [] })
    // Left edge of the band: no text there, just the translucent dark fill over white.
    const [r, g, b] = await pixelAt(png, 2, H - 3)
    expect(r).toBeLessThan(200)
    expect([r, g, b].every((v) => v === r)).toBe(true)
    // Above the band the design is untouched.
    expect(await pixelAt(png, 2, H - 40)).toEqual([255, 255, 255, 255])
  })

  test("a designer's privacy slot replaces the fallback band", async () => {
    const slot = { ...newTextSlot(W, H, 'privacy.notice'), id: 'pv', x: 0, y: 0, w: W, h: 40, color: '#000000' }
    const png = await render({ version: 1, slots: [slot] })
    expect(await pixelAt(png, 2, H - 3)).toEqual([255, 255, 255, 255])
  })
})
