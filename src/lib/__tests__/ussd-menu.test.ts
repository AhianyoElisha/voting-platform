import { describe, expect, test } from 'vitest'
import {
  applyQuote,
  initiated,
  initiateFailed,
  invalidQuantity,
  MESSAGES,
  parseState,
  quoteFailed,
  serializeState,
  start,
  step,
  type MenuState,
} from '../ussd/menu'

const quote = { nomineeName: 'Ama Owusu', categoryName: 'Miss Social Science', votePrice: 100 }

describe('USSD menu machine', () => {
  test('main menu routes 1, 2, 3 and rejects the rest', () => {
    expect(start().reply).toBe(MESSAGES.main)
    expect(step({ step: 'main' }, '1')).toMatchObject({
      reply: MESSAGES.enterCode,
      state: { step: 'code' },
      end: false,
    })
    expect(step({ step: 'main' }, '2')).toMatchObject({ reply: MESSAGES.ticketsSoon, end: true })
    expect(step({ step: 'main' }, '3')).toMatchObject({ reply: MESSAGES.help, end: true })
    expect(step({ step: 'main' }, '9')).toMatchObject({
      reply: MESSAGES.invalidChoice,
      state: { step: 'main' },
      end: false,
    })
    expect(step({ step: 'main' }, '')).toMatchObject({ state: { step: 'main' } })
  })

  test('code step validates and asks for a quote', () => {
    expect(step({ step: 'code' }, 'abc')).toMatchObject({ reply: MESSAGES.invalidCode, state: { step: 'code' } })
    expect(step({ step: 'code' }, '12')).toMatchObject({ reply: MESSAGES.invalidCode })
    const r = step({ step: 'code' }, ' 43 21 ')
    expect(r.action).toEqual({ type: 'quote', code: '4321' })
    expect(r.end).toBe(false)
  })

  test('a quote moves to quantity with the nominee, category and price shown', () => {
    const r = applyQuote({ step: 'code' }, '4321', quote)
    expect(r.reply).toBe('Miss Social Science\nAma Owusu\nGHS 1.00 per vote\nEnter number of votes:')
    expect(r.state).toEqual({
      step: 'quantity',
      code: '4321',
      nomineeName: 'Ama Owusu',
      categoryName: 'Miss Social Science',
      votePrice: 100,
    })
  })

  test('quote failures either re-ask or end', () => {
    expect(quoteFailed('nomineeNotFound')).toMatchObject({
      reply: MESSAGES.noNominee,
      state: { step: 'code' },
      end: false,
    })
    expect(quoteFailed('nomineeInactive')).toMatchObject({ state: { step: 'code' }, end: false })
    for (const p of ['eventNotLive', 'outsideWindow', 'noLiveRound', 'notInRound', 'organizationInactive'] as const) {
      expect(quoteFailed(p)).toMatchObject({ reply: MESSAGES.notOpen, end: true })
    }
    expect(quoteFailed('unknown')).toMatchObject({ reply: MESSAGES.unavailable, end: true })
  })

  test('quantity step computes the amount and asks for confirmation', () => {
    const q: MenuState = { step: 'quantity', code: '4321', nomineeName: 'Ama Owusu', categoryName: 'C', votePrice: 150 }
    expect(step(q, '0')).toMatchObject({ reply: invalidQuantity(1333), state: q })
    expect(step(q, '1.5')).toMatchObject({ reply: invalidQuantity(1333) })
    expect(step(q, 'ten')).toMatchObject({ reply: invalidQuantity(1333) })
    expect(step(q, '10001')).toMatchObject({ reply: invalidQuantity(1333) })
    // Decision #16: GHS 2,000 per payment at GHS 1.50 a vote is 1,333 votes.
    expect(step(q, '1334')).toMatchObject({ reply: 'Enter a whole number of votes (1 to 1333):', state: q })
    expect(step(q, '1333').state).toMatchObject({ step: 'confirm', quantity: 1333, amount: 199950 })
    const r = step(q, '10')
    expect(r.reply).toBe('Pay GHS 15.00 for 10 votes for Ama Owusu?\n1. Confirm\n2. Cancel')
    expect(r.state).toEqual({ step: 'confirm', code: '4321', nomineeName: 'Ama Owusu', quantity: 10, amount: 1500 })
    expect(step(q, '1').reply).toContain('for 1 vote for')
  })

  test('a price that changed between the quote and the confirmation ends the session without a charge', () => {
    expect(initiateFailed('priceChanged')).toEqual({ reply: MESSAGES.priceChanged, state: { step: 'done' }, end: true })
  })

  test('confirm is the only way to initiate; cancel ends; anything else re-asks', () => {
    const c: MenuState = { step: 'confirm', code: '4321', nomineeName: 'Ama Owusu', quantity: 3, amount: 450 }
    // The amount the voter confirmed travels with the action, so a changed price is refused.
    expect(step(c, '1').action).toEqual({ type: 'initiate', code: '4321', quantity: 3, amount: 450 })
    expect(step(c, '2')).toMatchObject({ reply: MESSAGES.cancelled, end: true })
    expect(step(c, 'x')).toMatchObject({ state: c, end: false })
    expect(step(c, 'x').reply).toContain('1. Confirm')
    // No other state produces an initiate action.
    for (const s of [{ step: 'main' }, { step: 'code' }, { step: 'done' }] as MenuState[]) {
      expect(step(s, '1').action?.type).not.toBe('initiate')
    }
  })

  test('initiation outcomes always end the session', () => {
    expect(initiated()).toMatchObject({ reply: MESSAGES.sent, end: true })
    expect(initiateFailed('phoneInvalid')).toMatchObject({ reply: MESSAGES.phoneInvalid, end: true })
    expect(initiateFailed('providerFailed')).toMatchObject({ reply: MESSAGES.paymentFailed, end: true })
    expect(initiateFailed('eventNotLive')).toMatchObject({ reply: MESSAGES.notOpen, end: true })
    expect(initiateFailed('feesNotConfigured')).toMatchObject({ reply: MESSAGES.unavailable, end: true })
  })

  test('every reply fits a USSD screen', () => {
    for (const m of Object.values(MESSAGES)) expect(m.length).toBeLessThanOrEqual(160)
    expect(
      applyQuote({ step: 'code' }, '4321', { ...quote, nomineeName: 'A'.repeat(60), categoryName: 'B'.repeat(40) })
        .reply.length
    ).toBeLessThanOrEqual(182)
  })

  test('state round-trips and junk parses to the main menu', () => {
    const c: MenuState = { step: 'confirm', code: '4321', nomineeName: 'Ama', quantity: 3, amount: 450 }
    expect(parseState(serializeState(c))).toEqual(c)
    expect(parseState('nope')).toEqual({ step: 'main' })
    expect(parseState(null)).toEqual({ step: 'main' })
  })
})
