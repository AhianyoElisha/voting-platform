import { NextResponse } from 'next/server'
import { TenantMismatchError, type TenantContext } from './db'
import { EventError } from './events-server'
import { getTranslations } from './i18n-server'
import { NomineeError } from './nominees-server'
import { RoundError } from './rounds-server'
import { ForbiddenError, NotAMemberError, requireTenantContext } from './tenant'

/**
 * Route-handler glue for tenant-scoped endpoints under `/api/orgs/[orgId]`.
 * The organization id in the URL is only honoured after `requireTenantContext`
 * finds the caller's membership (CLAUDE.md rule 4).
 */
export type TenantRouteResult =
  { ctx: TenantContext; t: Awaited<ReturnType<typeof getTranslations>>['t'] } | { response: NextResponse }

export async function withTenant(orgId: string): Promise<TenantRouteResult> {
  const { t } = await getTranslations()
  try {
    const ctx = await requireTenantContext(orgId)
    if (!ctx) return { response: NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 }) }
    return { ctx, t }
  } catch (err) {
    if (err instanceof NotAMemberError) {
      return { response: NextResponse.json({ error: t('errors:tenant.notAMember') }, { status: 403 }) }
    }
    throw err
  }
}

/** Maps domain errors to HTTP responses. Unknown errors become a logged 500. */
export function domainErrorResponse(err: unknown, t: (key: string) => string, tag: string): NextResponse {
  if (err instanceof ForbiddenError)
    return NextResponse.json({ error: t('errors:tenant.forbidden'), code: 'forbidden' }, { status: 403 })
  if (err instanceof TenantMismatchError || isNotFound(err)) {
    return NextResponse.json({ error: t('errors:tenant.notFound'), code: 'notFound' }, { status: 404 })
  }
  if (err instanceof EventError) {
    const status = err.problem === 'slugTaken' ? 409 : 400
    return NextResponse.json({ error: t(`errors:event.${err.problem}`), code: err.problem }, { status })
  }
  if (err instanceof RoundError) {
    return NextResponse.json({ error: t(`errors:round.${err.problem}`), code: err.problem }, { status: 400 })
  }
  if (err instanceof NomineeError) {
    return NextResponse.json({ error: t(`errors:nominee.${err.problem}`), code: err.problem }, { status: 400 })
  }
  console.error(`[${tag}] Error:`, err)
  return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: number }).code === 404
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null)
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
