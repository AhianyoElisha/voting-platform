'use client'

import { apiErrorMessage, postJson } from '@/components/events/api'
import { inputClass } from '@/components/organization/OrganizationFields'
import { tokenFromScan } from '@/lib/tickets/scan-input'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ScanResult = {
  outcome: 'admitted' | 'alreadyUsed' | 'cancelled' | 'invalid' | 'wrongEvent'
  ticket: { buyerName: string | null; buyerPhone: string; usedAt: string | null } | null
}

type Detector = { detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]> }
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats: string[] }) => Detector
  }
}

/**
 * Entrance scanner (PRD 5.4b; a web page, online only, decision #34). Uses the browser's built-in
 * barcode detector when present (Chrome on Android), with a paste box always
 * available. Each code is sent once; the server decides.
 */
export default function Scanner({ orgId, eventId }: { orgId: string; eventId: string }) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [supported, setSupported] = useState(false)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ token: string; result: ScanResult | null; error?: string } | null>(null)
  const lastTokenRef = useRef<string>('')

  useEffect(() => setSupported(typeof window !== 'undefined' && !!window.BarcodeDetector), [])

  const send = async (token: string) => {
    const clean = token.trim()
    if (!clean || busy) return
    setBusy(true)
    try {
      const result = await postJson<ScanResult>(`/api/orgs/${orgId}/events/${eventId}/tickets/scan`, { token: clean })
      setLast({ token: clean, result })
      if (navigator.vibrate) navigator.vibrate(result.outcome === 'admitted' ? 80 : [60, 40, 60])
    } catch (err) {
      setLast({ token: clean, result: null, error: apiErrorMessage(err, t('errors:auth.unknown')) })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!cameraOn || !videoRef.current || !window.BarcodeDetector) return
    const video = videoRef.current
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
    let stream: MediaStream | null = null
    let stop = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        video.srcObject = s
        return video.play()
      })
      .catch(() => setCameraOn(false))
    const loop = async () => {
      while (!stop) {
        try {
          const codes = await detector.detect(video)
          const value = codes[0]?.rawValue
          if (value && value !== lastTokenRef.current) {
            lastTokenRef.current = value
            await send(tokenFromScan(value))
          }
        } catch {
          /* frame not ready */
        }
        await new Promise((r) => setTimeout(r, 400))
      }
    }
    void loop()
    return () => {
      stop = true
      stream?.getTracks().forEach((tr) => tr.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn])

  const tone =
    last?.result?.outcome === 'admitted'
      ? 'border-green-300 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300'
      : last
        ? 'border-red-300 bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300'
        : 'border-neutral-200 dark:border-neutral-700'

  return (
    <div className="mx-auto max-w-md space-y-4">
      {supported ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setCameraOn((v) => !v)}
            className="w-full rounded-xl bg-primary-600 px-4 py-3 text-sm font-medium text-white"
          >
            {cameraOn ? t('web:scan.stopCamera') : t('web:scan.startCamera')}
          </button>
          {cameraOn && (
            <video
              ref={videoRef}
              muted
              playsInline
              className="aspect-square w-full rounded-2xl bg-black object-cover"
            />
          )}
        </div>
      ) : (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('web:scan.noCamera')}</p>
      )}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void send(tokenFromScan(manual))
          setManual('')
        }}
        className="flex gap-2"
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          className={inputClass}
          placeholder={t('web:scan.pastePlaceholder')}
          aria-label={t('web:scan.pastePlaceholder')}
        />
        <button
          type="submit"
          disabled={busy || !manual.trim()}
          className="shrink-0 rounded-xl border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-600"
        >
          {t('web:scan.check')}
        </button>
      </form>
      <div className={`rounded-2xl border p-5 text-center ${tone}`} aria-live="polite">
        {!last ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('web:scan.ready')}</p>
        ) : last.error ? (
          <p className="font-semibold">{last.error}</p>
        ) : (
          <>
            <p className="text-2xl font-bold">{t(`web:scan.outcome.${last.result!.outcome}`)}</p>
            {last.result!.ticket && (
              <p className="mt-1 text-sm">
                {last.result!.ticket.buyerName ?? ''} {last.result!.ticket.buyerPhone}
                {last.result!.outcome === 'alreadyUsed' && last.result!.ticket.usedAt
                  ? ` · ${t('web:scan.usedAt', { time: new Date(last.result!.ticket.usedAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra' }) })}`
                  : ''}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
