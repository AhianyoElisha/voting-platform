/**
 * Paystack adapter configuration (decided 2026-11-12: Paystack for payments,
 * Hubtel for USSD only). Everything comes from the environment and nothing
 * reaches the browser.
 *
 * Paystack's Charge API requires a customer email. Voters give none, so each
 * charge uses `<paymentId>@<PAYSTACK_CUSTOMER_EMAIL_DOMAIN>`: no personal data,
 * and nobody receives it. Turn off customer email receipts in the Paystack
 * dashboard so it does not try to send them.
 */
export interface PaystackConfig {
  secretKey: string
  baseUrl: string
  customerEmailDomain: string
  /** Optional allowlist of webhook source IPs; empty means not enforced (the signature always is). */
  callbackIps: string[]
  timeoutMs: number
}

export const PAYSTACK_DEFAULT_BASE_URL = 'https://api.paystack.co'

export class PaystackConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaystackConfigError'
  }
}

export function loadPaystackConfig(env: Record<string, string | undefined> = process.env): PaystackConfig {
  const secretKey = env.PAYSTACK_SECRET_KEY
  if (!secretKey) throw new PaystackConfigError('Missing PAYSTACK_SECRET_KEY')
  if (!/^sk_(test|live)_/.test(secretKey))
    throw new PaystackConfigError('PAYSTACK_SECRET_KEY must be a secret key (sk_…)')

  let domain = env.PAYSTACK_CUSTOMER_EMAIL_DOMAIN?.trim()
  if (!domain && env.NEXT_PUBLIC_APP_URL) {
    try {
      domain = new URL(env.NEXT_PUBLIC_APP_URL).hostname
    } catch {
      domain = undefined
    }
  }
  if (!domain || !domain.includes('.'))
    throw new PaystackConfigError('Set PAYSTACK_CUSTOMER_EMAIL_DOMAIN (a domain you own, e.g. voters.example.com)')

  return {
    secretKey,
    baseUrl: (env.PAYSTACK_BASE_URL ?? PAYSTACK_DEFAULT_BASE_URL).replace(/\/$/, ''),
    customerEmailDomain: domain,
    callbackIps: (env.PAYSTACK_CALLBACK_IPS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    timeoutMs: Number(env.PAYSTACK_TIMEOUT_MS ?? 15_000),
  }
}
