import { createAdminClient, withRetry } from '@/lib/appwrite-server'
import { getSessionUserId } from '@/lib/auth-session'
import { APPWRITE } from '@/lib/constants'
import { getUserDoc } from '@/lib/db'
import { getTranslations } from '@/lib/i18n-server'
import type { UserDoc } from '@/lib/types'
import { NextResponse } from 'next/server'

/**
 * POST /api/auth/sync-user
 *
 * Mirrors the `users` row to the Appwrite Auth account, keyed by the auth id
 * (`$id = authId`), the same way pickLT's sync-user does. Called by the auth
 * context after every successful sign-in or sign-up.
 *
 * Identity comes from the session cookie and the Auth record, never from the
 * request body: this route writes with the admin key. `isSuperAdmin` is never
 * written here; only the super admin console may set it.
 */
export async function POST() {
  const { t } = await getTranslations()
  try {
    const authId = await getSessionUserId()
    if (!authId) {
      return NextResponse.json({ error: t('errors:auth.unauthorized') }, { status: 401 })
    }

    const { databases, users } = createAdminClient()
    const authUser = await withRetry(() => users.get(authId))
    const email = authUser.email || ''
    const fullName = authUser.name || (email ? email.split('@')[0] : 'User')
    const phone = authUser.phone || null

    const existing = await getUserDoc(authId)
    let userDoc: UserDoc
    if (!existing) {
      userDoc = await withRetry(() =>
        databases.createDocument<UserDoc>(APPWRITE.DATABASE_ID, APPWRITE.TABLES.USERS, authId, {
          email,
          fullName,
          phone,
          isSuperAdmin: false,
        })
      )
    } else {
      userDoc = await withRetry(() =>
        databases.updateDocument<UserDoc>(APPWRITE.DATABASE_ID, APPWRITE.TABLES.USERS, authId, {
          email,
          fullName: fullName || existing.fullName,
          phone: phone ?? existing.phone,
        })
      )
    }

    return NextResponse.json({
      user: { id: userDoc.$id, email: userDoc.email, fullName: userDoc.fullName, isSuperAdmin: userDoc.isSuperAdmin },
      isNew: !existing,
    })
  } catch (err: unknown) {
    console.error('[sync-user] Error:', err)
    return NextResponse.json({ error: t('errors:auth.unknown') }, { status: 500 })
  }
}
