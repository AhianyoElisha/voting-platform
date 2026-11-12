'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'

const TABS = [
  { href: '/admin', key: 'overview' },
  { href: '/admin/organizations', key: 'organizations' },
  { href: '/admin/transactions', key: 'transactions' },
  { href: '/admin/payouts', key: 'payouts' },
  { href: '/admin/audit', key: 'audit' },
] as const

export default function AdminNav() {
  const { t } = useTranslation()
  const pathname = usePathname()
  return (
    <nav className="-mx-4 overflow-x-auto px-4">
      <ul className="flex gap-2 border-b border-neutral-200 dark:border-neutral-700">
        {TABS.map((tab) => {
          const active = tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href)
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={clsx(
                  'block border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
                  active
                    ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                    : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                )}
              >
                {t(`web:admin.nav.${tab.key}`)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
