import clsx from 'clsx'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

/**
 * A person's or organization's picture: the photo when there is one (anchored
 * at the nominee's chosen point, as on the flyer), else their initials on the
 * brand gradient. The size and shape come from `className`.
 */
export default function PhotoAvatar({
  name,
  photoUrl,
  focus,
  className,
}: {
  name: string
  photoUrl?: string | null
  /** Percent point kept in view when the photo is cropped (`photo-focus.ts`). */
  focus?: { x: number; y: number }
  className?: string
}) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name}
        loading="lazy"
        decoding="async"
        className={clsx('bg-neutral-100 object-cover dark:bg-neutral-700', className)}
        style={focus ? { objectPosition: `${focus.x}% ${focus.y}%` } : undefined}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={clsx(
        'flex items-center justify-center bg-linear-to-br from-primary-500 to-secondary-500 font-semibold text-white select-none',
        className
      )}
    >
      {initials(name)}
    </span>
  )
}
