import { describe, expect, test } from 'vitest'
import { isAuthorizedJobRequest } from '../internal-auth'

const env = { CRON_SECRET: 'cron-secret-value', INTERNAL_JOB_SECRET: 'job-secret-value' }

describe('isAuthorizedJobRequest', () => {
  test('accepts the Vercel cron bearer token', () => {
    expect(isAuthorizedJobRequest(new Headers({ authorization: 'Bearer cron-secret-value' }), env)).toBe(true)
    expect(isAuthorizedJobRequest(new Headers({ Authorization: 'bearer cron-secret-value' }), env)).toBe(true)
  })

  test('accepts the internal header', () => {
    expect(isAuthorizedJobRequest(new Headers({ 'x-internal-secret': 'job-secret-value' }), env)).toBe(true)
  })

  test('rejects wrong, empty and missing secrets, and refuses everything when nothing is configured', () => {
    expect(isAuthorizedJobRequest(new Headers({ authorization: 'Bearer nope' }), env)).toBe(false)
    expect(isAuthorizedJobRequest(new Headers({ 'x-internal-secret': 'job-secret-valu' }), env)).toBe(false)
    expect(isAuthorizedJobRequest(new Headers(), env)).toBe(false)
    expect(isAuthorizedJobRequest(new Headers({ authorization: 'Bearer ' }), { CRON_SECRET: '' })).toBe(false)
    expect(isAuthorizedJobRequest(new Headers({ 'x-internal-secret': '' }), {})).toBe(false)
  })
})
