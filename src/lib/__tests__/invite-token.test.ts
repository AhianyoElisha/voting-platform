import { describe, expect, test } from 'vitest'
import { INVITE_TTL_MS, checkInviteToken, generateInviteToken, hashInviteToken } from '../invite-token'

describe('invite tokens', () => {
  test('stores only a hash and verifies the original token', () => {
    const { token, hash, expiresAt } = generateInviteToken()
    expect(token).not.toBe(hash)
    expect(hash).toBe(hashInviteToken(token))
    expect(checkInviteToken(token, { inviteTokenHash: hash, inviteExpiresAt: expiresAt, claimedAt: null })).toBe('ok')
  })

  test('rejects a wrong, empty or short token', () => {
    const { hash, expiresAt } = generateInviteToken()
    const stored = { inviteTokenHash: hash, inviteExpiresAt: expiresAt, claimedAt: null }
    expect(checkInviteToken(generateInviteToken().token, stored)).toBe('invalid')
    expect(checkInviteToken('', stored)).toBe('invalid')
    expect(checkInviteToken('short', stored)).toBe('invalid')
    expect(checkInviteToken('x'.repeat(40), { ...stored, inviteTokenHash: null })).toBe('invalid')
  })

  test('expires and is single use', () => {
    const { token, hash, expiresAt } = generateInviteToken()
    const stored = { inviteTokenHash: hash, inviteExpiresAt: expiresAt, claimedAt: null }
    const later = new Date(Date.now() + INVITE_TTL_MS + 1000)
    expect(checkInviteToken(token, stored, later)).toBe('expired')
    expect(checkInviteToken(token, { ...stored, claimedAt: new Date().toISOString() })).toBe('used')
  })
})
