import { NextResponse } from 'next/server'
import { OrganizationSettingsError } from './organizations-server'

/** Maps organization-settings errors to a 400; anything else falls through to the shared handler. */
export function settingsErrorResponse(err: unknown, t: (key: string) => string): NextResponse | null {
  if (!(err instanceof OrganizationSettingsError)) return null
  return NextResponse.json({ error: t(`errors:orgSettings.${err.problem}`), code: err.problem }, { status: 400 })
}
