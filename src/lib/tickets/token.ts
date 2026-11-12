import crypto from 'crypto'

/**
 * Ticket QR tokens (DATA_MODEL.md "Ticketing"): `<ticketId>.<hmac>`. The
 * signature is HMAC-SHA256 over the ticket id with TICKET_SECRET, so a token
 * cannot be made up from a guessed id. The stored `qrToken` is compared too,
 * so a token signed under an old secret stops working after rotation.
 */
const SIG_LENGTH = 22

function secret(): string {
  const s = process.env.TICKET_SECRET
  if (!s) throw new Error('TICKET_SECRET is required for tickets')
  return s
}

export function signTicketToken(ticketId: string, key = secret()): string {
  const sig = crypto.createHmac('sha256', key).update(ticketId).digest('base64url').slice(0, SIG_LENGTH)
  return `${ticketId}.${sig}`
}

/** The ticket id inside a well-formed, correctly signed token; null otherwise. */
export function verifyTicketToken(token: string, key = secret()): string | null {
  if (typeof token !== 'string' || token.length > 96) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const id = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!/^[A-Za-z0-9_.-]{1,36}$/.test(id) || sig.length !== SIG_LENGTH) return null
  const expected = signTicketToken(id, key).slice(dot + 1)
  const enc = new TextEncoder()
  const a = enc.encode(sig)
  const b = enc.encode(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return id
}

/** Deterministic ticket ids: a replayed confirmation collides instead of issuing twice. */
export function ticketId(paymentId: string, index: number): string {
  return `tk_${paymentId}_${index}`
}

/**
 * The buyer's key to a ticket purchase. A payment id is not a secret: Appwrite
 * ids are a timestamp plus 28 non-cryptographic random bits, and every ticket
 * carries its payment id (`ticketId`), so anyone holding one ticket knows it.
 * Listing a purchase's tickets therefore needs this key, which is returned only
 * to the buyer's page when the purchase starts and never appears on a ticket.
 */
export function paymentAccessKey(paymentId: string, key = secret()): string {
  return crypto.createHmac('sha256', key).update(`payment-access:${paymentId}`).digest('base64url').slice(0, SIG_LENGTH)
}

export function verifyPaymentAccessKey(paymentId: string, given: string | null | undefined, key = secret()): boolean {
  if (!paymentId || typeof given !== 'string' || given.length !== SIG_LENGTH) return false
  const enc = new TextEncoder()
  const a = enc.encode(given)
  const b = enc.encode(paymentAccessKey(paymentId, key))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
