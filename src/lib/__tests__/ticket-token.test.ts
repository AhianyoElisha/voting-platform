import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  paymentAccessKey,
  signTicketToken,
  ticketId,
  verifyPaymentAccessKey,
  verifyTicketToken,
} from '../tickets/token'

beforeEach(() => {
  process.env.TICKET_SECRET = 'a'.repeat(32)
})
afterEach(() => {
  delete process.env.TICKET_SECRET
})

describe('ticket tokens', () => {
  test('round-trip', () => {
    const id = ticketId('pay_abc123', 2)
    const token = signTicketToken(id)
    expect(token.startsWith(`${id}.`)).toBe(true)
    expect(verifyTicketToken(token)).toBe(id)
  })

  test('rejects tampering, bare ids, a wrong secret and junk', () => {
    const id = ticketId('pay_abc123', 0)
    const token = signTicketToken(id)
    expect(verifyTicketToken(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).toBeNull()
    expect(verifyTicketToken(`${ticketId('pay_abc123', 1)}.${token.split('.')[1]}`)).toBeNull()
    expect(verifyTicketToken(id)).toBeNull()
    expect(verifyTicketToken('')).toBeNull()
    expect(verifyTicketToken('x'.repeat(200))).toBeNull()
    expect(verifyTicketToken(token, 'b'.repeat(32))).toBeNull()
  })

  test('requires the secret', () => {
    delete process.env.TICKET_SECRET
    expect(() => signTicketToken('tk_x_0')).toThrow(/TICKET_SECRET/)
  })
})

describe('payment access keys', () => {
  test('verify only for their own payment and secret, and differ from ticket signatures', () => {
    const key = paymentAccessKey('pay_abc123')
    expect(verifyPaymentAccessKey('pay_abc123', key)).toBe(true)
    expect(verifyPaymentAccessKey('pay_abc124', key)).toBe(false)
    expect(verifyPaymentAccessKey('pay_abc123', paymentAccessKey('pay_abc123', 'b'.repeat(32)))).toBe(false)
    expect(verifyPaymentAccessKey('pay_abc123', null)).toBe(false)
    expect(verifyPaymentAccessKey('pay_abc123', '')).toBe(false)
    expect(verifyPaymentAccessKey('', key)).toBe(false)
    // A ticket's own signature never doubles as the purchase key.
    const ticketSig = signTicketToken(ticketId('pay_abc123', 0)).split('.')[1]
    expect(verifyPaymentAccessKey('pay_abc123', ticketSig)).toBe(false)
  })
})
