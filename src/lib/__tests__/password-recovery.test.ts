import { describe, expect, it } from 'vitest'
import { parseRecoveryParams, recoveryUrl, requestOutcome, resetProblem } from '../password-recovery'

const params = (q: string) => new URLSearchParams(q)

describe('recoveryUrl', () => {
  it('points at the reset page on the given origin', () => {
    expect(recoveryUrl('https://vote.example.com')).toBe('https://vote.example.com/reset-password')
    expect(recoveryUrl('http://localhost:3000/')).toBe('http://localhost:3000/reset-password')
  })
})

describe('parseRecoveryParams', () => {
  const now = Date.parse('2026-11-12T10:00:00Z')

  it('reads userId and secret', () => {
    expect(parseRecoveryParams(params('userId=u1&secret=s1&expire=2026-11-12T11:00:00Z'), now)).toEqual({
      userId: 'u1',
      secret: 's1',
      expired: false,
    })
  })

  it('flags a link past its expiry', () => {
    expect(parseRecoveryParams(params('userId=u1&secret=s1&expire=2026-11-12T09:00:00.000+00:00'), now)?.expired).toBe(
      true
    )
  })

  it('reads an encoded offset too', () => {
    expect(
      parseRecoveryParams(params('userId=u1&secret=s1&expire=2026-11-12T11:00:00.000%2B00:00'), now)?.expired
    ).toBe(false)
  })

  it('treats a missing or unreadable expiry as not expired (Appwrite still checks)', () => {
    expect(parseRecoveryParams(params('userId=u1&secret=s1'), now)?.expired).toBe(false)
    expect(parseRecoveryParams(params('userId=u1&secret=s1&expire=soon'), now)?.expired).toBe(false)
  })

  it('rejects an incomplete link', () => {
    expect(parseRecoveryParams(params('userId=u1'), now)).toBeNull()
    expect(parseRecoveryParams(params('secret=s1'), now)).toBeNull()
    expect(parseRecoveryParams(params('userId=%20&secret=s1'), now)).toBeNull()
  })
})

describe('requestOutcome', () => {
  it('reports sent on success', () => {
    expect(requestOutcome(undefined)).toBe('sent')
  })

  it('reports sent for an unknown email, so accounts cannot be enumerated', () => {
    expect(requestOutcome({ code: 404, type: 'user_not_found' })).toBe('sent')
  })

  it('surfaces throttling and other faults', () => {
    expect(requestOutcome({ code: 429, type: 'general_rate_limit_exceeded' })).toBe('rateLimited')
    expect(requestOutcome({ code: 400, type: 'general_argument_invalid' })).toBe('unknown')
    expect(requestOutcome(new Error('network'))).toBe('unknown')
  })
})

describe('resetProblem', () => {
  it('maps an invalid, used or expired secret to an invalid link', () => {
    expect(resetProblem({ code: 401, type: 'user_invalid_token' })).toBe('recoveryLinkInvalid')
    expect(resetProblem({ code: 404, type: 'user_not_found' })).toBe('recoveryLinkInvalid')
  })

  it('maps password rule failures and throttling', () => {
    expect(resetProblem({ code: 400, type: 'password_recently_used' })).toBe('passwordRejected')
    expect(resetProblem({ code: 400, type: 'general_argument_invalid' })).toBe('recoveryLinkInvalid')
    expect(resetProblem({ code: 429 })).toBe('rateLimited')
    expect(resetProblem(new Error('network'))).toBe('unknown')
  })
})
