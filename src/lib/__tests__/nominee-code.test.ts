import { beforeEach, describe, expect, test, vi } from 'vitest'

const listDocuments = vi.fn()
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: { listDocuments } }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))
vi.mock('../db', () => ({ databaseId: () => 'voteapp' }))

import {
  NOMINEE_CODE_MAX_LENGTH,
  NomineeCodeExhaustedError,
  allocateNomineeCode,
  findNomineeByCode,
  isValidNomineeCode,
  normalizeNomineeCode,
  randomNomineeCode,
} from '../nominee-code'

beforeEach(() => listDocuments.mockReset())

describe('code format', () => {
  test('random codes are digits of the requested length with no leading zero', () => {
    for (let i = 0; i < 200; i++) {
      const code = randomNomineeCode(4)
      expect(code).toMatch(/^[1-9][0-9]{3}$/)
    }
    expect(randomNomineeCode(6)).toHaveLength(6)
  })

  test('validates 4 to 8 digits without a leading zero', () => {
    expect(isValidNomineeCode('1234')).toBe(true)
    expect(isValidNomineeCode('12345678')).toBe(true)
    expect(isValidNomineeCode('123')).toBe(false)
    expect(isValidNomineeCode('0123')).toBe(false)
    expect(isValidNomineeCode('123456789')).toBe(false)
    expect(isValidNomineeCode('12a4')).toBe(false)
  })

  test('normalizes what a voter might type', () => {
    expect(normalizeNomineeCode(' 12 34 ')).toBe('1234')
    expect(normalizeNomineeCode('0042')).toBe('42')
    expect(normalizeNomineeCode('ab')).toBe('')
  })
})

describe('allocateNomineeCode', () => {
  test('returns the first free candidate', async () => {
    const isTaken = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const code = await allocateNomineeCode(isTaken)
    expect(code).toMatch(/^[1-9][0-9]{3}$/)
    expect(isTaken).toHaveBeenCalledTimes(2)
  })

  test('grows the length after repeated collisions', async () => {
    let calls = 0
    const isTaken = vi.fn().mockImplementation(async () => ++calls <= 5)
    const code = await allocateNomineeCode(isTaken, { attemptsPerLength: 5 })
    expect(code).toHaveLength(5)
  })

  test('gives up once every length is exhausted', async () => {
    const isTaken = vi.fn().mockResolvedValue(true)
    await expect(allocateNomineeCode(isTaken, { attemptsPerLength: 2 })).rejects.toBeInstanceOf(
      NomineeCodeExhaustedError
    )
    expect(isTaken).toHaveBeenCalledTimes(2 * (NOMINEE_CODE_MAX_LENGTH - 4 + 1))
  })
})

describe('findNomineeByCode', () => {
  test('queries by the normalized code and returns the nominee with its organization', async () => {
    listDocuments.mockResolvedValue({ documents: [{ $id: 'n1', code: '4321', organizationId: 'org1' }] })
    const nominee = await findNomineeByCode(' 43 21')
    expect(nominee?.$id).toBe('n1')
    expect(nominee?.organizationId).toBe('org1')
    const [, table, queries] = listDocuments.mock.calls[0]
    expect(table).toBe('nominees')
    expect(queries.some((q: string) => q.includes('4321'))).toBe(true)
  })

  test('returns null for an invalid code without querying', async () => {
    await expect(findNomineeByCode('12')).resolves.toBeNull()
    await expect(findNomineeByCode('abc')).resolves.toBeNull()
    expect(listDocuments).not.toHaveBeenCalled()
  })

  test('returns null when nothing matches', async () => {
    listDocuments.mockResolvedValue({ documents: [] })
    await expect(findNomineeByCode('9999')).resolves.toBeNull()
  })
})
