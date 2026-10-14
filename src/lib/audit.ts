import { ID } from 'node-appwrite'
import { createAdminClient, withRetry } from './appwrite-server'
import { APPWRITE } from './constants'
import { databaseId } from './db'
import type { AuditLogDoc } from './types'

/**
 * Append-only audit trail (DATA_MODEL.md "Operations"). Used for anything an
 * organizer or super admin does that changes integrity-relevant state: morale
 * candidates, round closure, and later free-vote grants and payouts.
 */
export interface AuditEntry {
  actorId: string
  organizationId: string | null
  /** Dotted verb, e.g. `nominee.create_morale`, `round.close`. */
  action: string
  /** `table/id` of the thing acted on. */
  target: string
  metadata?: Record<string, unknown>
}

export async function writeAuditLog(entry: AuditEntry): Promise<AuditLogDoc> {
  const { databases } = createAdminClient()
  return withRetry(() =>
    databases.createDocument<AuditLogDoc>(databaseId(), APPWRITE.TABLES.AUDIT_LOGS, ID.unique(), {
      actorId: entry.actorId,
      organizationId: entry.organizationId,
      action: entry.action,
      target: entry.target,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    })
  )
}
