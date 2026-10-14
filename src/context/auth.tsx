'use client'

import { account } from '@/lib/appwrite'
import * as Sentry from '@sentry/nextjs'
import { ID } from 'appwrite'
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

/**
 * Auth context, same shape and flow as pickLT's `src/context/auth.tsx`, cut
 * down to email/password:
 *
 * 1. The browser signs in with the Appwrite Web SDK.
 * 2. `loadSession()` mints a short-lived Appwrite JWT and POSTs it to
 *    `/api/auth/init-session`, which sets our own signed httpOnly cookie so
 *    route handlers and the middleware can identify the user.
 * 3. Logout deletes the Appwrite session and clears that cookie.
 *
 * Roles (organizer admin / staff / nominee / super admin) come with the
 * Membership and Nominee collections, not here: this type is only what Appwrite
 * Auth knows about the user.
 */
export type User = {
  /** Appwrite Auth user ID */
  authId: string
  fullName: string
  email: string
  phone: string
  emailVerified: boolean
  /** Set once profile photos exist (organizer profile or nominee photo). */
  profilePhoto?: string
}

type AuthState = {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}

type AuthActions = {
  loginWithEmail: (email: string, password: string) => Promise<void>
  signupWithEmail: (email: string, password: string, name: string) => Promise<void>
  logout: () => Promise<void>
  /** `background`: a failed refresh keeps the current user instead of clearing it. */
  refreshSession: (opts?: { background?: boolean }) => Promise<void>
}

const AuthContext = createContext<(AuthState & AuthActions) | null>(null)

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Sentry knows who saw an error by id only, never name or email.
  const sentryUserId = user?.authId ?? null
  useEffect(() => {
    Sentry.setUser(sentryUserId ? { id: sentryUserId } : null)
  }, [sentryUserId])

  const loadSession = useCallback(async (opts?: { background?: boolean }) => {
    try {
      const appwriteUser = await account.get()

      // The Appwrite SDK session cookie lives on Appwrite's domain and is not
      // visible to our route handlers or middleware. Prove ownership of the
      // session with a JWT and let the server sign a cookie on our domain.
      try {
        const { jwt } = await account.createJWT()
        const initRes = await fetch('/api/auth/init-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jwt }),
        })
        if (!initRes.ok) {
          const detail = await initRes.json().catch(() => ({}))
          console.warn('[auth] init-session failed', initRes.status, detail?.error ?? '')
        }
      } catch (e) {
        console.warn('[auth] failed to initialize the server session cookie', e)
      }

      // Mirror the Auth account into the `users` row (keyed by auth id), as
      // pickLT's sync-user does. Best-effort: a failure here must not sign the
      // user out, the next load retries it.
      try {
        const syncRes = await fetch('/api/auth/sync-user', { method: 'POST' })
        if (!syncRes.ok) console.warn('[auth] sync-user failed', syncRes.status)
      } catch (e) {
        console.warn('[auth] sync-user failed', e)
      }

      setUser({
        authId: appwriteUser.$id,
        fullName: appwriteUser.name || '',
        email: appwriteUser.email || '',
        phone: appwriteUser.phone || '',
        emailVerified: appwriteUser.emailVerification ?? false,
      })
    } catch {
      if (!opts?.background) setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  const loginWithEmail = async (email: string, password: string) => {
    // A leftover session would block this one.
    await account.deleteSession('current').catch(() => {})
    await account.createEmailPasswordSession(email, password)
    await loadSession()
  }

  const signupWithEmail = async (email: string, password: string, name: string) => {
    await account.create(ID.unique(), email, password, name)
    await account.createEmailPasswordSession(email, password)
    await loadSession()
  }

  const logout = async () => {
    try {
      await account.deleteSession('current')
    } catch {
      // Session may already be expired
    }
    try {
      await fetch('/api/auth/clear-session', { method: 'POST' })
    } catch {
      // Best-effort
    }
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        loginWithEmail,
        signupWithEmail,
        logout,
        refreshSession: loadSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export default AuthContext
