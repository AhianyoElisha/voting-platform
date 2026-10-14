import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { signTicketToken, ticketId, verifyTicketToken } from '../tickets/token'

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
