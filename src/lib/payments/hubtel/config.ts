/**
 * Hubtel adapter configuration (decision #11). Everything comes from the
 * environment and nothing reaches the browser. Two things are deliberately
 * explicit rather than defaulted, because third-party sources disagree on
 * them and only the merchant sandbox settles it:
 *
 * - `HUBTEL_PAYLOAD_SHAPE`: `nested` (ResponseCode + Data{...}, the classic
 *   Receive Money API) or `flat` (top-level Status/ClientReference).
 * - the receive and status URLs, templated on `{merchant}`.
 *
 * See docs/HUBTEL_SMOKE_TEST.md for how to confirm them.
 */
export type HubtelPayloadShape = 'nested' | 'flat'

export interface HubtelConfig {
  clientId: string
  clientSecret: string
  merchantAccount: string
  /** Full URL for initiating a mobile-money receive; `{merchant}` is replaced. */
  receiveUrl: string
  /** Full URL for the status check; `{merchant}` is replaced, `clientReference` is appended as a query parameter. */
  statusUrl: string
  payloadShape: HubtelPayloadShape
  /** Our public callback URL, e.g. https://vote.example/api/payments/callback/hubtel */
  callbackUrl: string
  /** Optional allowlist of source IPs for callbacks; empty means not enforced. */
  callbackIps: string[]
  timeoutMs: number
}

export const HUBTEL_DEFAULT_RECEIVE_URL =
  'https://rmp.hubtel.com/merchantaccount/merchants/{merchant}/receive/mobilemoney'
export const HUBTEL_DEFAULT_STATUS_URL = 'https://api-txnstatus.hubtel.com/transactions/{merchant}/status'

export class HubtelConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HubtelConfigError'
  }
}

export function loadHubtelConfig(env: Record<string, string | undefined> = process.env): HubtelConfig {
  const required = [
    'HUBTEL_CLIENT_ID',
    'HUBTEL_CLIENT_SECRET',
    'HUBTEL_MERCHANT_ACCOUNT',
    'HUBTEL_PAYLOAD_SHAPE',
  ] as const
  const missing = required.filter((k) => !env[k])
  if (missing.length) throw new HubtelConfigError(`Missing ${missing.join(', ')}`)

  const shape = env.HUBTEL_PAYLOAD_SHAPE
  if (shape !== 'nested' && shape !== 'flat')
    throw new HubtelConfigError('HUBTEL_PAYLOAD_SHAPE must be "nested" or "flat"')

  const appUrl = (env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const callbackUrl = env.HUBTEL_CALLBACK_URL ?? (appUrl ? `${appUrl}/api/payments/callback/hubtel` : '')
  if (!/^https?:\/\//.test(callbackUrl))
    throw new HubtelConfigError('HUBTEL_CALLBACK_URL or NEXT_PUBLIC_APP_URL must be set')

  const merchant = env.HUBTEL_MERCHANT_ACCOUNT as string
  return {
    clientId: env.HUBTEL_CLIENT_ID as string,
    clientSecret: env.HUBTEL_CLIENT_SECRET as string,
    merchantAccount: merchant,
    receiveUrl: (env.HUBTEL_RECEIVE_URL ?? HUBTEL_DEFAULT_RECEIVE_URL).replace('{merchant}', merchant),
    statusUrl: (env.HUBTEL_STATUS_URL ?? HUBTEL_DEFAULT_STATUS_URL).replace('{merchant}', merchant),
    payloadShape: shape,
    callbackUrl,
    callbackIps: (env.HUBTEL_CALLBACK_IPS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    timeoutMs: Number(env.HUBTEL_TIMEOUT_MS ?? 10_000),
  }
}
