import { Query, type Models } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { APPWRITE } from './constants'
import { databaseId } from './db'
import type { NomineeDoc } from './types'

/**
 * Nominee codes (decision #12): numeric, unique across the whole platform,
 * generated server-side. A USSD voter types only this code, so it stays short
 * and digits-only. Codes are never reused and never organizer-chosen.
 *
 * Starts at 4 digits. The unique index on `nominees.code` is the guarantee;
 * generation just picks a random candidate and lets the index arbitrate.
 */
export const NOMINEE_CODE_MIN_LENGTH = 4
export const NOMINEE_CODE_MAX_LENGTH = 8
const CODE_PATTERN = /^[1-9][0-9]{3,7}$/

export function isValidNomineeCode(code: string): boolean {
  return CODE_PATTERN.test(code)
}

/** Digits a voter might type with spaces or a leading zero stripped. */
export function normalizeNomineeCode(input: string): string {
  return input.replace(/\D/g, '').replace(/^0+/, '')
}

/** One random candidate of `length` digits, no leading zero. */
export function randomNomineeCode(length = NOMINEE_CODE_MIN_LENGTH, rng: () => number = Math.random): string {
  const first = 1 + Math.floor(rng() * 9)
  let rest = ''
  for (let i = 1; i < length; i++) rest += Math.floor(rng() * 10)
  return `${first}${rest}`
}

export class NomineeCodeExhaustedError extends Error {
  constructor() {
    super('Could not allocate a unique nominee code')
    this.name = 'NomineeCodeExhaustedError'
  }
}

/**
 * Picks a code that `isTaken` does not know, growing the length after repeated
 * collisions so the space never runs dry. `isTaken` is a pre-check only: the
 * caller still inserts under the unique index and retries on 409.
 */
export async function allocateNomineeCode(
  isTaken: (code: string) => Promise<boolean>,
  opts: { attemptsPerLength?: number; rng?: () => number } = {}
): Promise<string> {
  const attemptsPerLength = opts.attemptsPerLength ?? 5
  for (let length = NOMINEE_CODE_MIN_LENGTH; length <= NOMINEE_CODE_MAX_LENGTH; length++) {
    for (let i = 0; i < attemptsPerLength; i++) {
      const code = randomNomineeCode(length, opts.rng)
      if (!(await isTaken(code))) return code
    }
  }
  throw new NomineeCodeExhaustedError()
}

type Doc<T> = T & Models.Document

/**
 * Platform-wide lookup by code. Deliberately NOT tenant-scoped: USSD and the
 * public vote page know only the code. Read-only; callers scope any write that
 * follows by the returned `organizationId`.
 */
export async function findNomineeByCode(input: string): Promise<Doc<NomineeDoc> | null> {
  const code = normalizeNomineeCode(input)
  if (!isValidNomineeCode(code)) return null
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<Doc<NomineeDoc>>(databaseId(), APPWRITE.TABLES.NOMINEES, [
      Query.equal('code', [code]),
      Query.limit(1),
    ])
  )
  return res.documents[0] ?? null
}

export async function isNomineeCodeTaken(code: string): Promise<boolean> {
  return (await findNomineeByCode(code)) !== null
}
