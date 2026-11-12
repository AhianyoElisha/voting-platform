/**
 * What a camera read or a pasted value means as a ticket token. The QR code
 * encodes the ticket page URL (`…/t/<token>`), and staff may paste either that
 * link or the bare code. Browser-safe (no Node imports), unlike `./token`.
 */
export function tokenFromScan(value: string): string {
  const trimmed = value.trim()
  const marker = trimmed.lastIndexOf('/t/')
  if (marker === -1) return trimmed
  return trimmed.slice(marker + 3).split(/[?#/]/)[0]
}
