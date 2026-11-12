import Link from 'next/link'

/** Shared bits for the admin console's server-rendered tables. */

export const th = 'px-3 py-2 text-left text-xs font-medium text-neutral-500 uppercase dark:text-neutral-400'
export const td = 'px-3 py-2 align-top'

export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-700">
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-neutral-500 dark:text-neutral-400">{children}</p>
}

/** "Next page" link that keeps the current filters. */
export function NextPage({
  next,
  base,
  params,
  label,
}: {
  next: string | null
  base: string
  params: Record<string, string>
  label: string
}) {
  if (!next) return null
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)), after: next })
  return (
    <div className="text-right">
      <Link href={`${base}?${qs}`} className="text-sm font-medium text-primary-700 underline dark:text-primary-400">
        {label}
      </Link>
    </div>
  )
}

export const selectClass =
  'rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white'
export const fieldClass =
  'rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white'
export const buttonClass =
  'rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50'
