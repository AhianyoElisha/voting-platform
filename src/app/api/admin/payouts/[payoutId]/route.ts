import { getTranslations } from '@/lib/i18n-server'
import { payoutErrorResponse, payoutView } from '@/lib/payouts-api'
import { decidePayout, markPayoutPaid } from '@/lib/payouts-server'
import { requireSuperAdmin } from '@/lib/super-admin'
import { ForbiddenError } from '@/lib/tenant'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ payoutId: string }> }

/** PATCH { action: 'approve' | 'reject' | 'paid', note? }. Super admin only. */
export async function PATCH(req: Request, { params }: Params) {
  const { t } = await getTranslations()
  let admin: string | null
  try {
    admin = await requireSuperAdmin()
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    throw err
  }
  if (!admin) return NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 })
  const { payoutId } = await params
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const note = typeof body?.note === 'string' ? body.note : undefined
  try {
    if (body?.action === 'approve')
      return NextResponse.json({ payout: payoutView(await decidePayout(admin, payoutId, 'approved', note)) })
    if (body?.action === 'reject')
      return NextResponse.json({ payout: payoutView(await decidePayout(admin, payoutId, 'rejected', note)) })
    if (body?.action === 'paid') {
      const { outcome, payout } = await markPayoutPaid(admin, payoutId, note)
      return NextResponse.json({ outcome, payout: payoutView(payout) })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const mapped = payoutErrorResponse(err, t)
    if (mapped) return mapped
    if ((err as { code?: number })?.code === 404) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    console.error('[admin.payouts] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
