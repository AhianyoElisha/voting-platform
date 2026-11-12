'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { CENTRE, type PhotoFocus } from '@/lib/photo-focus'
import { useRouter } from 'next/navigation'
import { KeyboardEvent, MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

const btn = 'rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50'
const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)))

/**
 * Lets a nominee or organizer mark the part of the photo that must stay in
 * view when the flyer crops it to the template's frame (FLYER_ENGINE.md).
 * The whole photo is shown; a tap sets the point, arrow keys nudge it.
 * Saving PATCHes `{ photoFocus }` to `endpoint`, which regenerates the flyer.
 */
export default function PhotoFocusPicker({
  photoUrl,
  initial,
  endpoint,
}: {
  photoUrl: string
  initial: PhotoFocus
  endpoint: string
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [focus, setFocus] = useState<PhotoFocus>(initial)
  const [saved, setSaved] = useState<PhotoFocus>(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const dirty = focus.x !== saved.x || focus.y !== saved.y

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    setFocus({
      x: clamp(((e.clientX - box.left) / box.width) * 100),
      y: clamp(((e.clientY - box.top) / box.height) * 100),
    })
    setMessage(null)
  }

  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] }[e.key]
    if (!step) return
    e.preventDefault()
    setFocus((f) => ({ x: clamp(f.x + step[0]), y: clamp(f.y + step[1]) }))
    setMessage(null)
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

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-neutral-900 dark:text-white">{t('web:photoFocus.title')}</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('web:photoFocus.helper')}</p>
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
        <img src={photoUrl} alt="" className="block h-auto w-full select-none" draggable={false} />
        <span
          aria-hidden
          title={t('web:photoFocus.marker')}
          className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary-600/60 shadow ring-1 ring-black/40"
          style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || busy}
          className={`${btn} bg-primary-600 text-white`}
        >
          {busy ? t('web:photoFocus.saving') : t('web:photoFocus.save')}
        </button>
        <button
          type="button"
          onClick={() => {
            setFocus(CENTRE)
            setMessage(null)
          }}
          disabled={busy || (focus.x === 50 && focus.y === 50)}
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
