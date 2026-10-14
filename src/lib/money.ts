/**
 * Money is stored as integer pesewas (CLAUDE.md rule 6). These are the only
 * places cedis and pesewas meet: forms take cedis, everything past the route
 * boundary is pesewas.
 */
export const PESEWAS_PER_CEDI = 100

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAmountError'
  }
}

/** "1.50" or 1.5 → 150. Rejects negatives, NaN and anything finer than a pesewa. */
export function cedisToPesewas(input: string | number): number {
  const raw = typeof input === 'number' ? String(input) : input.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new InvalidAmountError(`Not a cedi amount: ${JSON.stringify(input)}`)
  const [whole, frac = ''] = raw.split('.')
  const pesewas = Number(whole) * PESEWAS_PER_CEDI + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(pesewas)) throw new InvalidAmountError(`Amount too large: ${JSON.stringify(input)}`)
  return pesewas
}

/** 150 → "1.50". Integer arithmetic only. */
export function formatPesewas(pesewas: number, currency = 'GHS'): string {
  assertPesewas(pesewas)
  const whole = Math.floor(pesewas / PESEWAS_PER_CEDI)
  const frac = String(pesewas % PESEWAS_PER_CEDI).padStart(2, '0')
  return `${currency} ${whole}.${frac}`
}

export function isPesewas(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function assertPesewas(value: unknown): asserts value is number {
  if (!isPesewas(value)) throw new InvalidAmountError(`Not an integer pesewa amount: ${JSON.stringify(value)}`)
}
