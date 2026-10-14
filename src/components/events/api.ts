'use client'

/** Small fetch wrapper for the organizer forms: JSON in, `{ code }`-aware errors out. */
export async function postJson<T>(url: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): Promise<T> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.code ?? null, data?.error ?? null)
  return data as T
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string | null
  ) {
    super(message ?? `Request failed (${status})`)
    this.name = 'ApiError'
  }
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message) return err.message
  return fallback
}
