'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { placePhoto } from '@/lib/flyer/layout'
import type { PhotoFrame } from '@/lib/flyer/model'
import { CENTRE, ZOOM_MAX, ZOOM_MIN, isDefault, sameFocus, type PhotoFocus } from '@/lib/photo-focus'
import { useRouter } from 'next/navigation'
import { KeyboardEvent, MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

const btn = 'rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50'
const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)))

/**
 * Lets a nominee or organizer choose how the photo sits in the flyer's frame
 * (FLYER_ENGINE.md, "Photo position"): a tap marks the part that must stay in
 * view (arrow keys nudge it) and a slider zooms in. The whole photo is shown;
 * when the template's frame is known, the part the flyer will show is
 * outlined, computed with the renderer's own `placePhoto`. Saving PATCHes
 * `{ photoFocus }` to `endpoint`, which regenerates the flyer.
 */
export default function PhotoFocusPicker({
  photoUrl,
  initial,
  endpoint,
  frame,
}: {
  photoUrl: string
  initial: PhotoFocus
  endpoint: string
  /** The published template's photo frame; null while no template applies. */
  frame: PhotoFrame | null
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [focus, setFocus] = useState<PhotoFocus>(initial)
  const [saved, setSaved] = useState<PhotoFocus>(initial)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const change = (next: PhotoFocus) => {
    setFocus(next)
    setMessage(null)
  }

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    change({
      ...focus,
      x: clamp(((e.clientX - box.left) / box.width) * 100),
      y: clamp(((e.clientY - box.top) / box.height) * 100),
    })
  }

  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] }[e.key]
    if (!step) return
    e.preventDefault()
    change({ ...focus, x: clamp(focus.x + step[0]), y: clamp(focus.y + step[1]) })
  }

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await postJson(endpoint, { photoFocus: focus }, 'PATCH')
      setSaved(focus)
      setMessage({ ok: true, text: t('web:photoFocus.saved') })
      router.refresh()
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, t('errors:auth.unknown')) })
    } finally {
      setBusy(false)
    }
  }

  // The part of the photo the flyer shows, as percentages of the photo.
  const shown =
    frame && natural
      ? (() => {
          const { src } = placePhoto(natural.w, natural.h, frame.aspect * 1000, 1000, {
            fit: frame.fit,
            zoom: focus.zoom / 100,
            focusX: focus.x / 100,
            focusY: focus.y / 100,
          })
          return {
            left: `${(src.x / natural.w) * 100}%`,
            top: `${(src.y / natural.h) * 100}%`,
            width: `${(src.w / natural.w) * 100}%`,
            height: `${(src.h / natural.h) * 100}%`,
          }
        })()
      : null

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-neutral-900 dark:text-white">{t('web:photoFocus.title')}</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {t(frame ? 'web:photoFocus.helper' : 'web:photoFocus.helperNoTemplate')}
      </p>
      <div
        role="slider"
        tabIndex={0}
        aria-label={t('web:photoFocus.title')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={focus.y}
        aria-valuetext={`${focus.x}%, ${focus.y}%`}
        onClick={pick}
        onKeyDown={nudge}
        className="relative inline-block max-w-xs cursor-crosshair touch-manipulation overflow-hidden rounded-xl"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt=""
          className="block h-auto w-full select-none"
          draggable={false}
          ref={(img) => {
            // Covers an image that finished loading before React attached onLoad.
            if (img?.complete && img.naturalWidth > 0 && !natural)
              setNatural({ w: img.naturalWidth, h: img.naturalHeight })
          }}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
        {shown && (
          <span
            aria-hidden
            data-testid="photo-shown"
            className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
            style={shown}
          />
        )}
        <span
          aria-hidden
          title={t('web:photoFocus.marker')}
          className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary-600/60 shadow ring-1 ring-black/40"
          style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
        />
      </div>
      <label className="block max-w-xs text-xs text-neutral-700 dark:text-neutral-200">
        {t('web:photoFocus.zoom', { percent: focus.zoom })}
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={5}
          value={focus.zoom}
          onChange={(e) => change({ ...focus, zoom: Number(e.target.value) })}
          className="mt-1 block w-full"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || sameFocus(focus, saved)}
          className={`${btn} btn-brand`}
        >
          {busy ? t('web:photoFocus.saving') : t('web:photoFocus.save')}
        </button>
        <button
          type="button"
          onClick={() => change(CENTRE)}
          disabled={busy || isDefault(focus)}
          className={`${btn} border border-neutral-300 dark:border-neutral-600`}
        >
          {t('web:photoFocus.reset')}
        </button>
        {message && (
          <span role="status" className={`text-xs ${message.ok ? 'text-green-600' : 'text-red-600'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  )
}
