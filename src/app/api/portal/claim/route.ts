import { getTranslations } from '@/lib/i18n-server'
import { ClaimError, claimInvite } from '@/lib/nominee-invite-server'
import { rateLimit } from '@/lib/rate-limit'
import { NextResponse } from 'next/server'

/** POST { token, password }: set the nominee's password from a claim link. No session needed; the token is the proof. */
export async function POST(req: Request) {
  const { t } = await getTranslations()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`claim:${ip}`, 10, 60_000).ok) {
    return NextResponse.json({ error: t('errors:vote.rateLimited'), code: 'rateLimited' }, { status: 429 })
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const token = typeof body?.token === 'string' ? body.token : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  try {
    const { email } = await claimInvite(token, password)
    return NextResponse.json({ email })
  } catch (err) {
    if (err instanceof ClaimError) {
      return NextResponse.json({ error: t(`errors:claim.${err.problem}`), code: err.problem }, { status: 400 })
    }
    console.error('[portal.claim] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
