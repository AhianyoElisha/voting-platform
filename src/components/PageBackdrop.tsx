/**
 * The soft brand-coloured glow behind every page (pickLT's BgGlassmorphism,
 * in voteapp's colours). Purely decorative: fixed, behind the content, and
 * ignored by assistive technology and pointer events.
 */
export default function PageBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <span className="absolute -top-32 -left-24 block size-96 rounded-full bg-primary-400 opacity-20 blur-3xl dark:bg-primary-600 dark:opacity-15" />
      <span className="absolute top-1/3 -right-32 block size-[28rem] rounded-full bg-secondary-300 opacity-20 blur-3xl dark:bg-secondary-700 dark:opacity-10" />
      <span className="absolute -bottom-40 left-1/3 block size-96 rounded-full bg-amber-200 opacity-20 blur-3xl dark:bg-primary-900 dark:opacity-20" />
    </div>
  )
}
