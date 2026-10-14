import type { HubtelConfig } from './config'

/**
 * Minimal HTTP client for Hubtel: Basic auth, JSON, a timeout, and one retry
 * with backoff on 429 or a network fault. No business logic here.
 */
export class HubtelHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly body: unknown = null
  ) {
    super(message)
    this.name = 'HubtelHttpError'
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ReceiveMobileMoneyInput {
  clientReference: string
  /** Decimal cedis as a string, e.g. "1.50". */
  amountCedis: string
  msisdn: string
  customerName: string
  description: string
  channel: string | null
}

export class HubtelClient {
  constructor(
    private readonly cfg: HubtelConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`
  }

  private async request(url: string, init: RequestInit, attempt = 0): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(init.headers ?? {}),
        },
      })
    } catch (err) {
      clearTimeout(timer)
      if (attempt < 1) {
        await this.sleep(500)
        return this.request(url, init, attempt + 1)
      }
      throw new HubtelHttpError(`Hubtel request failed: ${err instanceof Error ? err.message : String(err)}`, null)
    }
    clearTimeout(timer)

    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    if (res.status === 429 && attempt < 1) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '1')
      await this.sleep(Math.min(Math.max(retryAfter, 1), 10) * 1000)
      return this.request(url, init, attempt + 1)
    }
    if (!res.ok) throw new HubtelHttpError(`Hubtel responded ${res.status}`, res.status, body)
    return body
  }

  async receiveMobileMoney(input: ReceiveMobileMoneyInput): Promise<unknown> {
    const payload: Record<string, unknown> = {
      CustomerName: input.customerName,
      CustomerMsisdn: input.msisdn,
      Amount: Number(input.amountCedis),
      PrimaryCallbackUrl: this.cfg.callbackUrl,
      Description: input.description,
      ClientReference: input.clientReference,
    }
    if (input.channel) payload.Channel = input.channel
    return this.request(this.cfg.receiveUrl, { method: 'POST', body: JSON.stringify(payload) })
  }

  async statusByClientReference(clientReference: string): Promise<unknown> {
    const url = new URL(this.cfg.statusUrl)
    url.searchParams.set('clientReference', clientReference)
    return this.request(url.toString(), { method: 'GET' })
  }
}
