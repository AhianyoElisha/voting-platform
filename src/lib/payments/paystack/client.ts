import type { PaystackConfig } from './config'

/**
 * Minimal HTTP client for Paystack: Bearer auth, JSON, a timeout. GETs retry
 * once on a network fault or 429; POSTs never retry, since a charge that
 * reached Paystack must not be sent twice. No business logic here.
 */
export class PaystackHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly body: unknown = null
  ) {
    super(message)
    this.name = 'PaystackHttpError'
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ChargeMobileMoneyInput {
  reference: string
  /** Pesewas. */
  amount: number
  email: string
  phone: string
  provider: string
  metadata: Record<string, unknown>
}

export class PaystackClient {
  constructor(
    private readonly cfg: PaystackConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  /** Returns the parsed body for any HTTP status Paystack answers with JSON; throws on transport faults. */
  private async request(path: string, init: RequestInit, attempt = 0): Promise<{ status: number; body: unknown }> {
    const retryable = (init.method ?? 'GET') === 'GET' && attempt < 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.cfg.secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      })
    } catch (err) {
      clearTimeout(timer)
      if (retryable) {
        await this.sleep(500)
        return this.request(path, init, attempt + 1)
      }
      throw new PaystackHttpError(`Paystack request failed: ${err instanceof Error ? err.message : String(err)}`, null)
    }
    clearTimeout(timer)
    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    if (res.status === 429 && retryable) {
      await this.sleep(1000)
      return this.request(path, init, attempt + 1)
    }
    if (res.status >= 500) throw new PaystackHttpError(`Paystack responded ${res.status}`, res.status, body)
    return { status: res.status, body }
  }

  chargeMobileMoney(input: ChargeMobileMoneyInput) {
    return this.request('/charge', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email,
        amount: input.amount,
        currency: 'GHS',
        reference: input.reference,
        mobile_money: { phone: input.phone, provider: input.provider },
        metadata: input.metadata,
      }),
    })
  }

  submitOtp(reference: string, otp: string) {
    return this.request('/charge/submit_otp', { method: 'POST', body: JSON.stringify({ reference, otp }) })
  }

  verify(reference: string) {
    return this.request(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' })
  }
}
