import { ID, Query } from 'node-appwrite'
import { createAdminClient, withRetry } from '../appwrite-server'
import { APPWRITE } from '../constants'
import { databaseId } from '../db'
import type { UssdSessionDoc } from '../types'
import { parseState, serializeState, type MenuState } from './menu'

/**
 * USSD session store. One row per aggregator session id. Sessions are short
 * lived: a step after `expiresAt` starts over rather than resuming, and a
 * `Timeout` or `Release` from the aggregator marks the row released.
 */
export const USSD_SESSION_TTL_MS = 3 * 60 * 1000

const db = () => databaseId()

export async function findSession(sessionId: string): Promise<UssdSessionDoc | null> {
  const { databases } = createAdminClient()
  const res = await withRetry(() =>
    databases.listDocuments<UssdSessionDoc>(db(), APPWRITE.TABLES.USSD_SESSIONS, [
      Query.equal('sessionId', [sessionId]),
      Query.limit(1),
    ])
  )
  return res.documents[0] ?? null
}

export function isLive(session: UssdSessionDoc | null, now = new Date()): session is UssdSessionDoc {
  return !!session && session.status === 'active' && new Date(session.expiresAt) > now
}

export async function startSession(
  input: { sessionId: string; phone: string; network: string | null },
  state: MenuState,
  now = new Date()
): Promise<UssdSessionDoc> {
  const { databases } = createAdminClient()
  const data = {
    sessionId: input.sessionId,
    phone: input.phone,
    network: input.network,
    state: serializeState(state),
    lastStep: state.step,
    status: 'active' as const,
    expiresAt: new Date(now.getTime() + USSD_SESSION_TTL_MS).toISOString(),
  }
  const existing = await findSession(input.sessionId)
  if (existing) {
    return withRetry(() =>
      databases.updateDocument<UssdSessionDoc>(db(), APPWRITE.TABLES.USSD_SESSIONS, existing.$id, data)
    )
  }
  try {
    return await withRetry(() =>
      databases.createDocument<UssdSessionDoc>(db(), APPWRITE.TABLES.USSD_SESSIONS, ID.unique(), data)
    )
  } catch (err) {
    // Two first steps raced on the unique session id: the other one won, update it.
    if ((err as { code?: number })?.code !== 409) throw err
    const winner = await findSession(input.sessionId)
    if (!winner) throw err
    return withRetry(() =>
      databases.updateDocument<UssdSessionDoc>(db(), APPWRITE.TABLES.USSD_SESSIONS, winner.$id, data)
    )
  }
}

export async function saveSession(
  session: UssdSessionDoc,
  state: MenuState,
  end: boolean,
  now = new Date()
): Promise<UssdSessionDoc> {
  const { databases } = createAdminClient()
  return withRetry(() =>
    databases.updateDocument<UssdSessionDoc>(db(), APPWRITE.TABLES.USSD_SESSIONS, session.$id, {
      state: serializeState(state),
      lastStep: state.step,
      status: end ? 'released' : 'active',
      expiresAt: new Date(now.getTime() + USSD_SESSION_TTL_MS).toISOString(),
    })
  )
}

export async function releaseSession(sessionId: string): Promise<void> {
  const session = await findSession(sessionId)
  if (!session || session.status === 'released') return
  const { databases } = createAdminClient()
  await withRetry(() =>
    databases.updateDocument(db(), APPWRITE.TABLES.USSD_SESSIONS, session.$id, { status: 'released' })
  )
}

export function sessionState(session: UssdSessionDoc): MenuState {
  return parseState(session.state)
}
