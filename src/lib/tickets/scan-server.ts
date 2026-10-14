import { createAdminClient, withRetry } from '../appwrite-server'
import { APPWRITE } from '../constants'
import { databaseId, getTenantDocument, runInTransaction, TenantMismatchError, type TenantContext } from '../db'
import { ForbiddenError } from '../tenant'
import type { MembershipRole, TicketDoc, TicketScanDoc } from '../types'
import { verifyTicketToken } from './token'

/**
 * Entrance scanning (PRD 5.4b): one atomic `valid → used` transition. The
 * transaction creates a `ticket_scans` row whose id is the ticket id, so two
 * simultaneous scans cannot both admit: the second commit collides and is
 * reported as already used. Tenant and event come from the caller's
 * membership and the URL; a valid token for another organization's ticket is
 * refused without revealing anything about it.
 */
export type ScanOutcome =
  | { outcome: 'admitted'; ticket: TicketDoc }
  | { outcome: 'alreadyUsed'; ticket: TicketDoc }
  | { outcome: 'cancelled'; ticket: TicketDoc }
  | { outcome: 'invalid' }
  | { outcome: 'wrongEvent' }

export const SCANNER_ROLES: readonly MembershipRole[] = ['owner', 'admin', 'staff', 'scanner']

export function canScan(role: MembershipRole): boolean {
  return SCANNER_ROLES.includes(role)
}

class AlreadyUsed extends Error {}

export async function scanTicket(ctx: TenantContext, eventId: string, token: string): Promise<ScanOutcome> {
  if (!canScan(ctx.role)) throw new ForbiddenError(`Role ${ctx.role} cannot scan tickets`)
  const id = verifyTicketToken((token ?? '').trim())
  if (!id) return { outcome: 'invalid' }

  let ticket: TicketDoc
  try {
    ticket = await getTenantDocument<TicketDoc>(ctx, APPWRITE.TABLES.TICKETS, id)
  } catch (err) {
    if (err instanceof TenantMismatchError || (err as { code?: number })?.code === 404) return { outcome: 'invalid' }
    throw err
  }
  // The stored token must match too: a token signed under a rotated secret is dead.
  if (ticket.qrToken !== token.trim()) return { outcome: 'invalid' }
  if (ticket.eventId !== eventId) return { outcome: 'wrongEvent' }
  if (ticket.status === 'cancelled') return { outcome: 'cancelled', ticket }
  if (ticket.status === 'used') return { outcome: 'alreadyUsed', ticket }

  const { databases } = createAdminClient()
  const now = new Date().toISOString()
  try {
    await runInTransaction(async (tx) => {
      const fresh = await databases.getDocument<TicketDoc>(databaseId(), APPWRITE.TABLES.TICKETS, ticket.$id, [], tx)
      if (fresh.status !== 'valid') throw new AlreadyUsed()
      await databases.createDocument<TicketScanDoc>(
        databaseId(),
        APPWRITE.TABLES.TICKET_SCANS,
        ticket.$id,
        { organizationId: ctx.organizationId, eventId, ticketId: ticket.$id, scannedBy: ctx.userId },
        undefined,
        tx
      )
      await databases.updateDocument<TicketDoc>(
        databaseId(),
        APPWRITE.TABLES.TICKETS,
        ticket.$id,
        { status: 'used', usedAt: now, scannedBy: ctx.userId },
        undefined,
        tx
      )
    })
  } catch (err) {
    const current = await withRetry(() =>
      databases.getDocument<TicketDoc>(databaseId(), APPWRITE.TABLES.TICKETS, ticket.$id)
    )
    if (err instanceof AlreadyUsed || current.status !== 'valid') {
      return current.status === 'cancelled'
        ? { outcome: 'cancelled', ticket: current }
        : { outcome: 'alreadyUsed', ticket: current }
    }
    throw err
  }
  const admitted = await withRetry(() =>
    databases.getDocument<TicketDoc>(databaseId(), APPWRITE.TABLES.TICKETS, ticket.$id)
  )
  return { outcome: 'admitted', ticket: admitted }
}
