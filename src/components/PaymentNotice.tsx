'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'

/**
 * The consent notice under the phone field of every payment form (decision
 * #28, 2026-11-13): a short line and a link to the privacy policy. A notice,
 * not a checkbox.
 */
export default function PaymentNotice() {
  const { t } = useTranslation()
  return (
    // A span, so it can sit inside a <label> as well as a <div>.
    <span className="mt-1 block text-xs font-normal text-neutral-500 dark:text-neutral-400">
      {t('web:paymentNotice.text')}{' '}
      <Link href="/privacy" target="_blank" className="underline hover:text-neutral-700 dark:hover:text-neutral-200">
        {t('web:paymentNotice.link')}
      </Link>
    </span>
  )
}
