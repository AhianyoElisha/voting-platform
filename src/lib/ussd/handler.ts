import type { PaymentProvider } from '../payments'
import { normalizeGhanaPhone } from '../phone'
import { VoteError, initiateVotePayment, quoteVote } from '../votes-server'
import {
  applyQuote,
  initiateFailed,
  initiated,
  initiatedNeedsOtp,
  quoteFailed,
  start,
  step,
  type MenuResult,
} from './menu'
import { findSession, isLive, releaseSession, saveSession, sessionState, startSession } from './session'

/**
 * Aggregator-agnostic USSD handler. The transport (src/lib/ussd/hubtel.ts)
 * turns the aggregator's request into `UssdInput` and this returns the text
 * to show and whether to end the session.
 *
 * The caller's phone comes from the aggregator, so a USSD vote's payment is
 * always for the dialling number. Confirmation is the only step that creates
 * a (pending) Payment, through the same `initiateVotePayment` as the web.
 */
export interface UssdInput {
  sessionId: string
  phone: string
  network?: string | null
  text: string
  type: 'initiation' | 'response' | 'timeout' | 'release'
}

export interface UssdOutput {
  message: string
  end: boolean
}

export async function handleUssd(
  input: UssdInput,
  opts: { now?: Date; provider?: PaymentProvider } = {}
): Promise<UssdOutput> {
  const now = opts.now ?? new Date()

  if (input.type === 'timeout' || input.type === 'release') {
    await releaseSession(input.sessionId)
    return { message: '', end: true }
  }

  const phone = normalizeGhanaPhone(input.phone) ?? input.phone.replace(/\D/g, '')
  let session = input.type === 'initiation' ? null : await findSession(input.sessionId)

  if (!isLive(session, now)) {
    const first = start()
    session = await startSession(
      { sessionId: input.sessionId, phone, network: input.network ?? null },
      first.state,
      now
    )
    // Some aggregators send the first menu choice with the initiation; most send an empty message.
    if (input.type === 'initiation' && !input.text.trim()) return { message: first.reply, end: false }
  }

  let result: MenuResult = step(sessionState(session), input.text)

  if (result.action?.type === 'quote') {
    try {
      const quote = await quoteVote(result.action.code, now)
      result = applyQuote(sessionState(session), result.action.code, {
        nomineeName: quote.nominee.name,
        categoryName: quote.categoryName,
        votePrice: quote.votePrice,
      })
    } catch (err) {
      result = quoteFailed(err instanceof VoteError ? err.problem : 'unknown')
      if (!(err instanceof VoteError)) console.error('[ussd] quote failed', err)
    }
  } else if (result.action?.type === 'initiate') {
    try {
      const started = await initiateVotePayment(
        {
          code: result.action.code,
          quantity: result.action.quantity,
          phone: session.phone,
          channel: 'ussd',
          expectedAmount: result.action.amount,
        },
        { provider: opts.provider, now }
      )
      result = started.nextAction === 'otp' ? initiatedNeedsOtp() : initiated()
    } catch (err) {
      result = initiateFailed(err instanceof VoteError ? err.problem : 'unknown')
      if (!(err instanceof VoteError)) console.error('[ussd] initiate failed', err)
    }
  }

  await saveSession(session, result.state, result.end, now)
  return { message: result.reply, end: result.end }
}
