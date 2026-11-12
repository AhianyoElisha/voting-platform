import { textColorOn, type BrandColors } from '@/lib/branding'
import Link from 'next/link'

/**
 * The organization's header on its public pages: logo and name on the brand
 * colour, with the text colour chosen for contrast. Without branding, a plain
 * line with the logo (if any) and the name.
 */
export default function BrandBand({
  name,
  logoUrl,
  colors,
  href,
  className = '',
}: {
  /** The organization's home page; the name links there. */
  href?: string
  name: string
  logoUrl: string | null
  colors: BrandColors | null
  className?: string
}) {
  const logo = logoUrl ? (
    // A remote, organization-supplied image of unknown size: a plain img keeps it simple.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" className="h-10 w-auto max-w-[120px] object-contain" />
  ) : null
  const label = href ? (
    <Link href={href} className="hover:underline">
      {name}
    </Link>
  ) : (
    name
  )
  if (!colors) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        {logo}
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{label}</p>
      </div>
    )
  }
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${className}`}
      style={{
        backgroundColor: colors.primary,
        color: textColorOn(colors.primary),
        borderBottom: colors.accent ? `4px solid ${colors.accent}` : undefined,
      }}
    >
      {logo && <span className="rounded-lg bg-white/90 p-1">{logo}</span>}
      <p className="text-sm font-semibold">{label}</p>
    </div>
  )
}
