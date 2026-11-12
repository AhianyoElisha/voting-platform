'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { SAMPLE_CONTEXT, resolveBinding } from '@/lib/flyer/bindings'
import type { FontResolution } from '@/lib/flyer/font-resolve-server'
import {
  FALLBACK_FONT,
  TEXT_BINDINGS,
  newPhotoSlot,
  newTextSlot,
  type PhotoSlot,
  type Slot,
  type SlotModel,
  type TextBinding,
  type TextSlot,
} from '@/lib/flyer/model'
import { buildSlots, type PsdWarning } from '@/lib/flyer/psd-plan'
import { Canvas, Ellipse, FabricImage, FabricObject, Rect, Textbox } from 'fabric'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface TemplateView {
  id: string
  name: string
  width: number
  height: number
  backgroundUrl: string | null
  /** Layers drawn over the photo (PSD import). */
  foregroundUrl: string | null
  /** The photo slot's shape when it is `mask` (PSD import). */
  photoMaskUrl: string | null
  model: SlotModel
  status: string
  version: number
}

export interface FontView {
  id: string
  family: string
  weight: number
  style: string
  url: string
  platform: boolean
}

const btn = 'rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50'
const btnPrimary = `${btn} btn-brand`
const btnSecondary = `${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700`
const field = `${inputClass} py-1.5 text-xs`

/** Shown in help text; passed as values because i18next would read `{{name}}` as a variable. */
const PSD_TAGS = {
  tags: '{{name}}, {{code}}, {{category}}, {{event}}, {{ussd}} and {{photo}} (or {{photo:round}})',
  photoTag: '{{photo}}',
}

interface ImportReport {
  slots: number
  fonts: FontResolution[]
  /** Fonts used only by static text, which is baked into the background. */
  otherFonts: string[]
  warnings: PsdWarning[]
}

/**
 * The template personalizer (FLYER_ENGINE.md, rule 7): place a photo frame
 * and bound text slots on a fixed background. Fabric.js draws the canvas and
 * handles drag, resize and rotate; what we persist is our own slot model,
 * which the server renders with the same geometry.
 */
export default function TemplateEditor({
  orgId,
  eventId,
  template,
  fonts,
}: {
  orgId: string
  eventId: string
  template: TemplateView
  fonts: FontView[]
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const canvasEl = useRef<HTMLCanvasElement | null>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const objectsRef = useRef(new Map<string, FabricObject>())
  const [model, setModel] = useState<SlotModel>(template.model)
  const [name, setName] = useState(template.name)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)

  const scale = useMemo(
    () => Math.min(1, 420 / template.width, 640 / template.height),
    [template.width, template.height]
  )
  const families = useMemo(() => [FALLBACK_FONT, ...Array.from(new Set(fonts.map((f) => f.family)))], [fonts])
  const selected = model.slots.find((s) => s.id === selectedId) ?? null

  // Load uploaded fonts into the page so the preview uses them.
  useEffect(() => {
    for (const f of fonts) {
      const face = new FontFace(f.family, `url(${f.url})`, { weight: String(f.weight), style: f.style })
      face
        .load()
        .then((loaded) => document.fonts.add(loaded))
        .catch(() => {})
    }
  }, [fonts])

  const syncFromCanvas = useCallback(() => {
    setModel((current) => ({
      ...current,
      slots: current.slots.map((slot) => {
        const obj = objectsRef.current.get(slot.id)
        if (!obj) return slot
        const w = obj.getScaledWidth() / scale
        const h = obj.getScaledHeight() / scale
        // Objects are center-origin (see `common` below): left/top is the box center.
        return {
          ...slot,
          x: Math.round((obj.left ?? 0) / scale - w / 2),
          y: Math.round((obj.top ?? 0) / scale - h / 2),
          w: Math.round(w),
          h: Math.round(h),
          rotation: Math.round(obj.angle ?? 0),
        }
      }),
    }))
    setDirty(true)
  }, [scale])

  // Build the Fabric canvas once.
  useEffect(() => {
    if (!canvasEl.current) return
    const objects = objectsRef.current
    const canvas = new Canvas(canvasEl.current, {
      width: template.width * scale,
      height: template.height * scale,
      preserveObjectStacking: true,
    })
    fabricRef.current = canvas
    canvas.on('object:modified', syncFromCanvas)
    canvas.on('selection:created', (e) =>
      setSelectedId((e.selected?.[0] as FabricObject & { slotId?: string })?.slotId ?? null)
    )
    canvas.on('selection:updated', (e) =>
      setSelectedId((e.selected?.[0] as FabricObject & { slotId?: string })?.slotId ?? null)
    )
    canvas.on('selection:cleared', () => setSelectedId(null))
    if (template.backgroundUrl) {
      FabricImage.fromURL(template.backgroundUrl, { crossOrigin: 'anonymous' })
        .then((img) => {
          img.scaleToWidth(template.width * scale)
          // Fabric >= 6 defaults to a center origin, which would hang the image off the canvas.
          img.set({ originX: 'left', originY: 'top', left: 0, top: 0 })
          canvas.backgroundImage = img
          canvas.requestRenderAll()
        })
        .catch(() => {})
    } else {
      canvas.backgroundColor = '#111827'
    }
    if (template.foregroundUrl) {
      // Shown over the slots, half see-through so the photo frame underneath stays findable.
      FabricImage.fromURL(template.foregroundUrl, { crossOrigin: 'anonymous' })
        .then((img) => {
          img.scaleToWidth(template.width * scale)
          img.set({ originX: 'left', originY: 'top', left: 0, top: 0, opacity: 0.6 })
          canvas.overlayImage = img
          canvas.requestRenderAll()
        })
        .catch(() => {})
    }
    return () => {
      void canvas.dispose()
      fabricRef.current = null
      objects.clear()
    }
  }, [template.width, template.height, template.backgroundUrl, template.foregroundUrl, scale, syncFromCanvas])

  // Reconcile Fabric objects with the model (positions from the model, styling from the slot).
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    const seen = new Set<string>()
    for (const slot of model.slots) {
      seen.add(slot.id)
      let obj = objectsRef.current.get(slot.id)
      // Center origin, so rotation pivots on the box center exactly as the server renderer
      // does (render.ts); the model keeps x/y as the unrotated box's top-left corner.
      const common = {
        originX: 'center' as const,
        originY: 'center' as const,
        left: (slot.x + slot.w / 2) * scale,
        top: (slot.y + slot.h / 2) * scale,
        angle: slot.rotation,
        scaleX: 1,
        scaleY: 1,
      }
      if (slot.type === 'photo') {
        const style = { fill: 'rgba(59,130,246,0.25)', stroke: '#3b82f6', strokeDashArray: [6, 4], strokeUniform: true }
        const wantEllipse = slot.shape === 'ellipse'
        if (obj && (obj as FabricObject & { isEllipse?: boolean }).isEllipse !== wantEllipse) {
          canvas.remove(obj)
          obj = undefined
        }
        if (!obj) {
          obj = wantEllipse
            ? new Ellipse({ ...common, rx: (slot.w * scale) / 2, ry: (slot.h * scale) / 2, ...style })
            : new Rect({
                ...common,
                width: slot.w * scale,
                height: slot.h * scale,
                rx: slot.radius * scale,
                ry: slot.radius * scale,
                ...style,
              })
          ;(obj as FabricObject & { slotId?: string; isEllipse?: boolean }).slotId = slot.id
          ;(obj as FabricObject & { isEllipse?: boolean }).isEllipse = wantEllipse
          canvas.add(obj)
          objectsRef.current.set(slot.id, obj)
        } else {
          if (wantEllipse) obj.set({ ...common, rx: (slot.w * scale) / 2, ry: (slot.h * scale) / 2 })
          else
            obj.set({
              ...common,
              width: slot.w * scale,
              height: slot.h * scale,
              rx: slot.radius * scale,
              ry: slot.radius * scale,
            })
        }
      } else {
        const text = resolveBinding(slot, SAMPLE_CONTEXT) || ' '
        if (!obj) {
          obj = new Textbox(text, { ...common, width: slot.w * scale, editable: false, lockScalingY: false })
          ;(obj as FabricObject & { slotId?: string }).slotId = slot.id
          canvas.add(obj)
          objectsRef.current.set(slot.id, obj)
        }
        obj.set({
          ...common,
          width: slot.w * scale,
          text,
          fontFamily: slot.fontFamily,
          fontWeight: slot.fontWeight,
          fontStyle: slot.italic ? 'italic' : 'normal',
          fontSize: slot.fontSize * scale,
          fill: slot.color,
          textAlign: slot.align,
        })
        // Textbox height follows its text; we keep the model's box height as the fit limit.
        ;(obj as Textbox).set({ height: slot.h * scale })
      }
      obj.setCoords()
    }
    for (const [id, obj] of objectsRef.current) {
      if (!seen.has(id)) {
        canvas.remove(obj)
        objectsRef.current.delete(id)
      }
    }
    canvas.requestRenderAll()
    // The canvas is rebuilt when the background changes (a PSD import of the same size keeps
    // `scale`), and a rebuilt canvas starts empty, so redraw then too.
  }, [model, scale, template.backgroundUrl, template.foregroundUrl])

  const update = (patch: Partial<Slot>) => {
    if (!selected) return
    setModel((m) => ({ ...m, slots: m.slots.map((s) => (s.id === selected.id ? ({ ...s, ...patch } as Slot) : s)) }))
    setDirty(true)
  }

  const addPhoto = () => {
    if (model.slots.some((s) => s.type === 'photo')) return
    setModel((m) => ({ ...m, slots: [...m.slots, newPhotoSlot(template.width, template.height)] }))
    setDirty(true)
  }
  const addText = (binding: TextBinding) => {
    setModel((m) => ({ ...m, slots: [...m.slots, newTextSlot(template.width, template.height, binding)] }))
    setDirty(true)
  }
  const removeSelected = () => {
    if (!selected) return
    setModel((m) => ({ ...m, slots: m.slots.filter((s) => s.id !== selected.id) }))
    setSelectedId(null)
    setDirty(true)
  }

  const base = `/api/orgs/${orgId}/events/${eventId}/templates/${template.id}`
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await fn()
      setMessage(label)
    } catch (err) {
      setError(
        err instanceof Error && !('status' in err) ? err.message : apiErrorMessage(err, t('errors:auth.unknown'))
      )
    } finally {
      setBusy(false)
    }
  }
  const save = () =>
    run(t('web:flyer.editor.saved'), async () => {
      await postJson(base, { model, name }, 'PUT')
      setDirty(false)
      router.refresh()
    })
  const publish = () =>
    run(t('web:flyer.editor.published'), async () => {
      if (dirty) await postJson(base, { model, name }, 'PUT')
      await postJson(`${base}/publish`, {})
      setDirty(false)
      router.refresh()
    })
  const uploadBackground = (file: File) =>
    run(t('web:flyer.editor.backgroundSet'), async () => {
      const form = new FormData()
      form.append('background', file)
      const res = await fetch(`${base}/background`, { method: 'POST', body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'upload failed')
      router.refresh()
    })
  const removeForeground = () =>
    run(t('web:flyer.editor.overlayRemoved'), async () => {
      const res = await fetch(`${base}/layers/foreground`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'failed')
      router.refresh()
    })
  const importPsd = async (file: File) => {
    if (model.slots.length > 0 && !window.confirm(t('web:flyer.psd.replaceConfirm'))) return
    await run(t('web:flyer.psd.imported'), async () => {
      let parsed: Awaited<ReturnType<typeof import('./psd-import').readPsdForImport>>
      try {
        const { readPsdForImport } = await import('./psd-import')
        parsed = await readPsdForImport(file)
      } catch (err) {
        console.warn('[flyer] PSD read failed', err)
        throw new Error(t('web:flyer.psd.readFailed'))
      }
      const { plan, background, foreground, photoMask } = parsed
      // Detect and fetch the slot fonts first, so the slots can name the right family.
      const fonts = plan.slotFonts.length
        ? (await postJson<{ fonts: FontResolution[] }>(`/api/orgs/${orgId}/fonts/resolve`, { names: plan.slotFonts }))
            .fonts
        : []
      const form = new FormData()
      const ext = background.type === 'image/jpeg' ? 'jpg' : 'png'
      form.append('background', new File([background], `background.${ext}`, { type: background.type }))
      const res = await fetch(`${base}/background`, { method: 'POST', body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'upload failed')
      // A new background clears the old overlay and mask; send this design's, if any.
      for (const [kind, blob] of [
        ['foreground', foreground],
        ['photoMask', photoMask],
      ] as const) {
        if (!blob) continue
        const layer = new FormData()
        layer.append('image', new File([blob], `${kind}.png`, { type: 'image/png' }))
        const lr = await fetch(`${base}/layers/${kind}`, { method: 'POST', body: layer })
        if (!lr.ok) throw new Error((await lr.json().catch(() => null))?.error ?? 'upload failed')
      }
      // The server shrinks large backgrounds; scale the PSD's coordinates the same way.
      const scale = (data.template.width as number) / plan.width
      const slots = buildSlots(plan, fonts, scale).map((s) =>
        s.type === 'photo' && photoMask ? { ...s, shape: 'mask' as const } : s
      )
      const next: SlotModel = { version: 1, slots }
      await postJson(base, { model: next, name }, 'PUT')
      setModel(next)
      setSelectedId(null)
      setDirty(false)
      setReport({
        slots: next.slots.length,
        fonts,
        otherFonts: plan.designFonts.filter((f) => !plan.slotFonts.includes(f)),
        warnings: plan.warnings,
      })
      router.refresh()
    })
  }

  // No cache-buster: the route answers `no-store`, and a Date.now() here made the server
  // and client render different hrefs (hydration mismatch).
  const previewUrl = `${base}/preview?model=${encodeURIComponent(JSON.stringify(model))}`

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
      {/* Help text must not widen the auto column past the canvas (420 px plus padding). */}
      <div className="space-y-3 lg:max-w-[440px]">
        <div className="rounded-xl border border-neutral-300 bg-neutral-100 p-2 dark:border-neutral-700 dark:bg-neutral-800">
          <canvas ref={canvasEl} />
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {template.width} × {template.height} px · {t('web:flyer.editor.canvasHint')}
        </p>
        {template.foregroundUrl && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            {t('web:flyer.editor.overlayHint')}
            <button type="button" onClick={() => void removeForeground()} disabled={busy} className={btnSecondary}>
              {t('web:flyer.editor.removeOverlay')}
            </button>
          </p>
        )}
        <label className="block text-xs">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">{t('web:flyer.editor.background')}</span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && void uploadBackground(e.target.files[0])}
            className="mt-1 block w-full text-xs"
          />
        </label>
        <label className="block text-xs">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">{t('web:flyer.psd.label')}</span>
          <input
            type="file"
            accept=".psd,image/vnd.adobe.photoshop"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importPsd(f)
            }}
            className="mt-1 block w-full text-xs"
          />
          <span className="mt-1 block text-neutral-500 dark:text-neutral-400">
            {t('web:flyer.psd.helper', PSD_TAGS)}
          </span>
        </label>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setDirty(true)
            }}
            className={`${field} max-w-xs`}
            aria-label={t('web:flyer.editor.name')}
          />
          <button
            type="button"
            onClick={addPhoto}
            disabled={model.slots.some((s) => s.type === 'photo')}
            className={btnSecondary}
          >
            {t('web:flyer.editor.addPhoto')}
          </button>
          <select
            onChange={(e) => {
              if (e.target.value) addText(e.target.value as TextBinding)
              e.target.value = ''
            }}
            className={`${field} w-auto`}
            defaultValue=""
            aria-label={t('web:flyer.editor.addText')}
          >
            <option value="">{t('web:flyer.editor.addText')}</option>
            {TEXT_BINDINGS.map((b) => (
              <option key={b} value={b}>
                {t(`web:flyer.binding.${b}`)}
              </option>
            ))}
          </select>
          <button type="button" onClick={removeSelected} disabled={!selected} className={btnSecondary}>
            {t('web:flyer.editor.remove')}
          </button>
          <span className="grow" />
          <a href={previewUrl} target="_blank" rel="noreferrer" className={btnSecondary}>
            {t('web:flyer.editor.preview')}
          </a>
          <button type="button" onClick={() => void save()} disabled={busy || !dirty} className={btnSecondary}>
            {t('web:flyer.editor.save')}
          </button>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={busy || !template.backgroundUrl}
            className={btnPrimary}
          >
            {template.status === 'published' ? t('web:flyer.editor.republish') : t('web:flyer.editor.publish')}
          </button>
        </div>
        {(message || error) && (
          <p className={`text-xs ${error ? 'text-red-600' : 'text-green-600'}`}>{error || message}</p>
        )}

        {report && <PsdReport report={report} onClose={() => setReport(null)} />}

        {selected ? (
          <div className="grid gap-3 rounded-xl border border-neutral-200 p-4 text-xs sm:grid-cols-2 dark:border-neutral-700">
            {selected.type === 'photo' ? (
              <>
                <label>
                  {t('web:flyer.editor.shape')}
                  <select
                    value={selected.shape}
                    onChange={(e) => update({ shape: e.target.value as PhotoSlot['shape'] })}
                    className={field}
                  >
                    <option value="ellipse">{t('web:flyer.editor.ellipse')}</option>
                    <option value="rect">{t('web:flyer.editor.rect')}</option>
                    {(template.photoMaskUrl || selected.shape === 'mask') && (
                      <option value="mask">{t('web:flyer.editor.maskShape')}</option>
                    )}
                  </select>
                </label>
                <label>
                  {t('web:flyer.editor.fit')}
                  <select
                    value={selected.fit ?? 'cover'}
                    onChange={(e) => update({ fit: e.target.value as 'cover' | 'contain' })}
                    className={field}
                  >
                    <option value="cover">{t('web:flyer.editor.fitCover')}</option>
                    <option value="contain">{t('web:flyer.editor.fitContain')}</option>
                  </select>
                </label>
                {selected.shape === 'rect' && (
                  <label>
                    {t('web:flyer.editor.radius')}
                    <input
                      type="number"
                      min={0}
                      value={selected.radius}
                      onChange={(e) => update({ radius: Math.max(0, Number(e.target.value) || 0) })}
                      className={field}
                    />
                  </label>
                )}
              </>
            ) : (
              <>
                <label>
                  {t('web:flyer.editor.binding')}
                  <select
                    value={selected.binding}
                    onChange={(e) => update({ binding: e.target.value as TextBinding })}
                    className={field}
                  >
                    {TEXT_BINDINGS.map((b) => (
                      <option key={b} value={b}>
                        {t(`web:flyer.binding.${b}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {selected.binding === 'custom' && (
                  <label>
                    {t('web:flyer.editor.text')}
                    <input value={selected.text} onChange={(e) => update({ text: e.target.value })} className={field} />
                  </label>
                )}
                <label>
                  {t('web:flyer.editor.font')}
                  <select
                    value={selected.fontFamily}
                    onChange={(e) => update({ fontFamily: e.target.value })}
                    className={field}
                  >
                    {families.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('web:flyer.editor.weight')}
                  <select
                    value={selected.fontWeight}
                    onChange={(e) => update({ fontWeight: Number(e.target.value) })}
                    className={field}
                  >
                    {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('web:flyer.editor.size')}
                  <input
                    type="number"
                    min={4}
                    value={selected.fontSize}
                    onChange={(e) => update({ fontSize: Math.max(4, Number(e.target.value) || 4) })}
                    className={field}
                  />
                </label>
                <label>
                  {t('web:flyer.editor.minSize')}
                  <input
                    type="number"
                    min={4}
                    max={selected.fontSize}
                    value={selected.minFontSize}
                    onChange={(e) =>
                      update({ minFontSize: Math.min(selected.fontSize, Math.max(4, Number(e.target.value) || 4)) })
                    }
                    className={field}
                  />
                </label>
                <label>
                  {t('web:flyer.editor.color')}
                  <input
                    type="color"
                    value={selected.color.slice(0, 7)}
                    onChange={(e) => update({ color: e.target.value })}
                    className="mt-1 block h-8 w-16"
                  />
                </label>
                <label>
                  {t('web:flyer.editor.align')}
                  <select
                    value={selected.align}
                    onChange={(e) => update({ align: e.target.value as TextSlot['align'] })}
                    className={field}
                  >
                    <option value="left">{t('web:flyer.editor.left')}</option>
                    <option value="center">{t('web:flyer.editor.center')}</option>
                    <option value="right">{t('web:flyer.editor.right')}</option>
                  </select>
                </label>
                <label>
                  {t('web:flyer.editor.maxLines')}
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={selected.maxLines}
                    onChange={(e) => update({ maxLines: Math.min(6, Math.max(1, Number(e.target.value) || 1)) })}
                    className={field}
                  />
                </label>
                <label className="flex items-center gap-2 pt-4">
                  <input
                    type="checkbox"
                    checked={selected.uppercase}
                    onChange={(e) => update({ uppercase: e.target.checked })}
                  />
                  {t('web:flyer.editor.uppercase')}
                </label>
                <label className="flex items-center gap-2 pt-4">
                  <input
                    type="checkbox"
                    checked={selected.italic === true}
                    onChange={(e) => update({ italic: e.target.checked })}
                  />
                  {t('web:flyer.editor.italic')}
                </label>
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('web:flyer.editor.selectHint')}</p>
        )}
      </div>
    </div>
  )
}

const statusStyle: Record<FontResolution['status'], string> = {
  available: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  fetched: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  upload: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
}

/** What the PSD import found: slots, the fonts they need and where each comes from, and caveats. */
function PsdReport({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  const { t } = useTranslation()
  const needUpload = report.fonts.filter((f) => f.status === 'upload')
  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 p-4 text-xs dark:border-neutral-700">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-neutral-900 dark:text-white">
          {t('web:flyer.psd.report.title', { count: report.slots })}
        </p>
        <button type="button" onClick={onClose} className="text-neutral-500 underline">
          {t('web:flyer.psd.report.close')}
        </button>
      </div>
      {report.warnings.map((w) => (
        <p key={w} className="text-amber-700 dark:text-amber-400">
          {t(`web:flyer.psd.warning.${w}`, PSD_TAGS)}
        </p>
      ))}
      {report.fonts.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-neutral-800 dark:text-neutral-200">{t('web:flyer.psd.report.fonts')}</p>
          <ul className="space-y-1">
            {report.fonts.map((f) => (
              <li key={f.postScriptName} className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 font-medium ${statusStyle[f.status]}`}>
                  {t(`web:flyer.psd.status.${f.status}`)}
                </span>
                <span className="text-neutral-800 dark:text-neutral-200">
                  {f.family} · {f.weight}
                  {f.italic ? ` · ${t('web:flyer.editor.italic')}` : ''}
                </span>
                <span className="text-neutral-500">({f.postScriptName})</span>
                {f.substituted && <span className="text-neutral-500">{t('web:flyer.psd.report.substituted')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {needUpload.length > 0 && (
        <p className="text-neutral-600 dark:text-neutral-300">
          {needUpload.some((f) => f.googleUnavailable)
            ? t('web:flyer.psd.report.googleDown')
            : t('web:flyer.psd.report.uploadHelp')}
        </p>
      )}
      {report.otherFonts.length > 0 && (
        <p className="text-neutral-500 dark:text-neutral-400">
          {t('web:flyer.psd.report.otherFonts', { fonts: report.otherFonts.join(', ') })}
        </p>
      )}
    </div>
  )
}
