import { createAdminClient, withRetry } from '@/lib/appwrite-server'
import { APPWRITE } from '@/lib/constants'
import { databaseId } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import { payoutView } from '@/lib/payouts-api'
import { listAllPayouts } from '@/lib/payouts-server'
import { requireSuperAdmin } from '@/lib/super-admin'
import { ForbiddenError } from '@/lib/tenant'
import type { OrganizationDoc, PayoutStatus } from '@/lib/types'
import { NextResponse } from 'next/server'
import { Query } from 'node-appwrite'

/** GET ?status=requested,approved: payouts across every organization. Super admin only. */
export async function GET(req: Request) {
  const { t } = await getTranslations()
  try {
    const admin = await requireSuperAdmin()
    if (!admin) return NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 })
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    throw err
  }
  const raw = new URL(req.url).searchParams.get('status') ?? 'requested,approved'
  const statuses = raw
    .split(',')
    .filter((s): s is PayoutStatus => ['requested', 'approved', 'paid', 'rejected'].includes(s))
  const payouts = await listAllPayouts(statuses.length ? statuses : ['requested', 'approved'])
  const { databases } = createAdminClient()
  const orgIds = [...new Set(payouts.map((p) => p.organizationId))]
  const orgs = orgIds.length
    ? await withRetry(() =>
        databases.listDocuments<OrganizationDoc>(databaseId(), APPWRITE.TABLES.ORGANIZATIONS, [
          Query.equal('$id', orgIds),
          Query.limit(100),
        ])
      )
    : { documents: [] as OrganizationDoc[] }
  const name = new Map(orgs.documents.map((o) => [o.$id, o.name]))
  return NextResponse.json({ payouts: payouts.map((p) => payoutView(p, name.get(p.organizationId))) })
}
