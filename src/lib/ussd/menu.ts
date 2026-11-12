import { VOTE_QUANTITY_MAX_PLACEHOLDER, VOTE_QUANTITY_MIN } from '../constants'
import { formatPesewas } from '../money'
import { isValidNomineeCode, normalizeNomineeCode } from '../nominee-code'
import type { VoteProblem } from '../votes-server'

/**
 * The USSD menu as a pure state machine (USSD_AND_PAYMENTS.md "Proposed USSD
 * flow"). Input in, reply text and next state out. Anything that needs data
 * comes back as an `action` for the handler to perform, after which the
 * handler feeds the result into `applyQuote` / `initiated` / `failed`.
 *
 * It never touches money or votes: the only way out of `confirm` with "1" is
 * the `initiate` action, which the handler turns into a pending Payment
 * through the same pipeline the web uses.
 */
export type MenuState =
  | { step: 'main' }
  | { step: 'code' }
  | { step: 'quantity'; code: string; nomineeName: string; categoryName: string; votePrice: number }
  | { step: 'confirm'; code: string; nomineeName: string; quantity: number; amount: number }
  | { step: 'done' }

export type MenuAction = { type: 'quote'; code: string } | { type: 'initiate'; code: string; quantity: number }

export interface MenuResult {
  reply: string
  state: MenuState
  action?: MenuAction
  /** True when the session should be released after this reply. */
  end: boolean
}

export interface Quote {
  nomineeName: string
  categoryName: string
  /** Pesewas. */
  votePrice: number
}

/** Keep replies short: a USSD screen holds about 160 characters. */
export const MESSAGES = {
  main: 'Vote\n1. Vote\n2. Buy ticket\n3. Help',
  invalidChoice: 'Invalid choice.\n1. Vote\n2. Buy ticket\n3. Help',
  enterCode: 'Enter nominee code:',
  invalidCode: 'Invalid code. Enter nominee code:',
  ticketsSoon: 'Tickets by USSD are coming soon.',
  help: 'To vote: choose 1, enter the nominee code from their flyer, enter how many votes, then approve the MoMo prompt.',
  enterQuantity: 'Enter number of votes:',
  invalidQuantity: `Enter a whole number of votes (${VOTE_QUANTITY_MIN} to ${VOTE_QUANTITY_MAX_PLACEHOLDER}):`,
  cancelled: 'Cancelled. Dial again to vote.',
  sent: 'A MoMo prompt has been sent to your phone. Approve it with your PIN to complete your vote.',
  otpUnsupported:
    'Your network needs an SMS code for this payment, which cannot be entered here. You have not been charged. Please vote on the website instead.',
  unavailable: 'Voting is temporarily unavailable. Please try again later.',
  paymentFailed: 'The payment could not be started. Please try again.',
  phoneInvalid: 'This number cannot be used for mobile money.',
  tooMany: 'Too many attempts from this number. Please wait a minute and dial again.',
  notOpen: 'Voting is not open for this event right now.',
  noNominee: 'No nominee has that code. Enter nominee code:',
  nomineeInactive: 'That nominee is no longer in the running. Enter nominee code:',
} as const

export function start(): MenuResult {
  return { reply: MESSAGES.main, state: { step: 'main' }, end: false }
}

export function step(state: MenuState, rawInput: string): MenuResult {
  const input = (rawInput ?? '').trim()
  switch (state.step) {
    case 'main':
      if (input === '1') return { reply: MESSAGES.enterCode, state: { step: 'code' }, end: false }
      if (input === '2') return { reply: MESSAGES.ticketsSoon, state: { step: 'done' }, end: true }
      if (input === '3') return { reply: MESSAGES.help, state: { step: 'done' }, end: true }
      return { reply: MESSAGES.invalidChoice, state: { step: 'main' }, end: false }

    case 'code': {
      const code = normalizeNomineeCode(input)
      if (!isValidNomineeCode(code)) return { reply: MESSAGES.invalidCode, state: { step: 'code' }, end: false }
      // The reply is decided once the handler has the quote.
      return { reply: '', state, action: { type: 'quote', code }, end: false }
    }

    case 'quantity': {
      const n = /^\d+$/.test(input) ? Number(input) : NaN
      if (!Number.isInteger(n) || n < VOTE_QUANTITY_MIN || n > VOTE_QUANTITY_MAX_PLACEHOLDER) {
        return { reply: MESSAGES.invalidQuantity, state, end: false }
      }
      const amount = state.votePrice * n
      const next: MenuState = { step: 'confirm', code: state.code, nomineeName: state.nomineeName, quantity: n, amount }
      return { reply: confirmText(next), state: next, end: false }
    }

    case 'confirm':
      if (input === '1')
        return {
          reply: '',
          state,
          action: { type: 'initiate', code: state.code, quantity: state.quantity },
          end: false,
        }
      if (input === '2') return { reply: MESSAGES.cancelled, state: { step: 'done' }, end: true }
      return { reply: confirmText(state), state, end: false }

    case 'done':
      return start()
  }
}

function confirmText(state: Extract<MenuState, { step: 'confirm' }>): string {
  const votes = `${state.quantity} vote${state.quantity === 1 ? '' : 's'}`
  return `Pay ${formatPesewas(state.amount)} for ${votes} for ${state.nomineeName}?\n1. Confirm\n2. Cancel`
}

/** After a successful `quote` action. */
export function applyQuote(state: MenuState, code: string, quote: Quote): MenuResult {
  if (state.step !== 'code') return start()
  const next: MenuState = {
    step: 'quantity',
    code,
    nomineeName: quote.nomineeName,
    categoryName: quote.categoryName,
    votePrice: quote.votePrice,
  }
  return {
    reply: `${quote.categoryName}\n${quote.nomineeName}\n${formatPesewas(quote.votePrice)} per vote\n${MESSAGES.enterQuantity}`,
    state: next,
    end: false,
  }
}

/** After a failed `quote` action: either ask again or end, depending on the reason. */
export function quoteFailed(problem: VoteProblem | 'unknown'): MenuResult {
  if (problem === 'nomineeNotFound') return { reply: MESSAGES.noNominee, state: { step: 'code' }, end: false }
  if (problem === 'nomineeInactive') return { reply: MESSAGES.nomineeInactive, state: { step: 'code' }, end: false }
  if (['eventNotLive', 'outsideWindow', 'noLiveRound', 'notInRound', 'organizationInactive'].includes(problem)) {
    return { reply: MESSAGES.notOpen, state: { step: 'done' }, end: true }
  }
  return { reply: MESSAGES.unavailable, state: { step: 'done' }, end: true }
}

/** After a successful `initiate` action. */
export function initiated(): MenuResult {
  return { reply: MESSAGES.sent, state: { step: 'done' }, end: true }
}

/**
 * The provider wants a one-time code before the prompt (Paystack `send_otp`),
 * which a USSD session cannot collect. The payment stays pending and
 * reconciliation marks it failed once the provider reports it abandoned.
 */
export function initiatedNeedsOtp(): MenuResult {
  return { reply: MESSAGES.otpUnsupported, state: { step: 'done' }, end: true }
}

/** After a failed `initiate` action. The session always ends; nothing is pending. */
export function initiateFailed(problem: VoteProblem | 'unknown'): MenuResult {
  if (problem === 'phoneInvalid') return { reply: MESSAGES.phoneInvalid, state: { step: 'done' }, end: true }
  if (problem === 'providerFailed') return { reply: MESSAGES.paymentFailed, state: { step: 'done' }, end: true }
  if (problem === 'rateLimited') return { reply: MESSAGES.tooMany, state: { step: 'done' }, end: true }
  if (
    [
      'eventNotLive',
      'outsideWindow',
      'noLiveRound',
      'notInRound',
      'organizationInactive',
      'nomineeNotFound',
      'nomineeInactive',
    ].includes(problem)
  ) {
    return { reply: MESSAGES.notOpen, state: { step: 'done' }, end: true }
  }
  return { reply: MESSAGES.unavailable, state: { step: 'done' }, end: true }
}

export function serializeState(state: MenuState): string {
  return JSON.stringify(state)
}

export function parseState(raw: string | null | undefined): MenuState {
  if (!raw) return { step: 'main' }
  try {
    const parsed = JSON.parse(raw) as MenuState
    if (parsed && typeof parsed === 'object' && typeof parsed.step === 'string') return parsed
  } catch {
    /* fall through */
  }
  return { step: 'main' }
}
