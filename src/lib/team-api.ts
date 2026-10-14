import { NextResponse } from 'next/server'
import { TeamError } from './team-server'

export function teamErrorResponse(err: unknown, t: (key: string) => string): NextResponse | null {
  if (err instanceof TeamError) {
    const status = err.problem === 'alreadyMember' || err.problem === 'alreadyInvited' ? 409 : 400
    return NextResponse.json({ error: t(`errors:team.${err.problem}`), code: err.problem }, { status })
  }
  return null
}
