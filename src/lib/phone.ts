/**
 * Ghanaian mobile numbers, stored as E.164 digits without the plus
 * (233XXXXXXXXX). Accepts "024 123 4567", "+233241234567", "233241234567".
 */
export function normalizeGhanaPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  let national: string
  if (digits.length === 10 && digits.startsWith('0')) national = digits.slice(1)
  else if (digits.length === 12 && digits.startsWith('233')) national = digits.slice(3)
  else if (digits.length === 9) national = digits
  else return null
  // Mobile prefixes start with 2 or 5 (MTN, Vodafone/Telecel, AirtelTigo).
  if (!/^[25]\d{8}$/.test(national)) return null
  return `233${national}`
}

/**
 * A phone number with all but the last three digits hidden, for anyone who
 * only needs to tell buyers apart: the ticket page (meant to be forwarded),
 * the door scanner and staff. Only managers see full numbers (#28).
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  return phone.length > 3 ? `${'•'.repeat(phone.length - 3)}${phone.slice(-3)}` : phone
}
