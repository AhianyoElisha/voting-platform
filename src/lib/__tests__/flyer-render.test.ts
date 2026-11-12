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
        model: { version: 1, slots: [{ ...slot, color: '#000000' }] },
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
