import { readResetInput, resetPasswordWithRecovery } from '@/lib/password-recovery-server'
import { COOKIE_NAME } from '@/lib/session'
import { NextResponse } from 'next/server'

/**
 * POST /api/auth/reset-password  { userId, secret, password }
 *
 * Completes Appwrite password recovery on the server so the user can then be
 * signed out of every device (`src/lib/password-recovery-server.ts`). The
 * recovery secret is the proof; Appwrite checks it, its expiry and its
 * single use, and rate-limits attempts per user.
 */
export async function POST(req: Request) {
  const input = readResetInput(await req.json().catch(() => null))
  if (!input) return NextResponse.json({ problem: 'recoveryLinkInvalid' }, { status: 400 })

  const result = await resetPasswordWithRecovery(input)
  if (!result.ok) {
    const status = result.problem === 'rateLimited' ? 429 : result.problem === 'recoveryLinkInvalid' ? 401 : 400
    return NextResponse.json({ problem: result.problem }, { status })
  }

  const response = NextResponse.json({ ok: true })
  // This browser is signed out too; the user signs in again with the new password.
  response.cookies.set(COOKIE_NAME, '', {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
  })
  return response
}
