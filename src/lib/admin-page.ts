import { notFound, redirect } from 'next/navigation'
import { getSessionUserId } from './auth-session'
import { getTranslations } from './i18n-server'
import { isSuperAdmin, requireSuperAdmin } from './super-admin'
import { ForbiddenError } from './tenant'

/**
 * Guard for every `/admin` page: signed out → login, signed in but not a
 * super admin → 404 (the console's existence is not advertised). Each page
 * calls it itself, because a layout is not re-run on client navigation.
 */
export async function requireAdminPage(path: string): Promise<string> {
  let admin: string | null
  try {
    admin = await requireSuperAdmin()
  } catch (err) {
    if (err instanceof ForbiddenError) notFound()
    throw err
  }
  if (!admin) redirect(`/login?redirect=${encodeURIComponent(path)}`)
  return admin
}

/** Accra time, as the rest of the app shows it. */
export function formatWhen(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Accra' }) : ''
}

/** One string from a search param. */
export function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

/**
 * Page metadata that names the page only for a super admin; others get the
 * 404 page, and its title should not give the console away either.
 */
export async function adminMetadata(titleKey: string): Promise<{ title?: string }> {
  if (!(await isSuperAdmin(await getSessionUserId()))) return {}
  const { t } = await getTranslations()
  return { title: t(titleKey) }
}
