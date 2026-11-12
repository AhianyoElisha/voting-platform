import QRCode from 'qrcode'
import type { EmailProvider, NomineeInviteEmail, SendResult, TeamInviteEmail, TicketEmail } from './provider'
import { nomineeInviteEmail, teamInviteEmail, ticketsEmail, type RenderedEmail } from './templates'

/**
 * Resend adapter (decided 2026-11-12, settles #32). One HTTPS call per email
 * to `POST /emails`. A failure is reported as `sent: false, reason: 'failed'`
 * and never thrown, so callers keep their fallback (the organizer can still
 * copy a claim link; the buyer still has the ticket page).
 */
export const RESEND_PROVIDER_NAME = 'resend'

export interface ResendConfig {
  apiKey: string
  /** e.g. `voteapp <tickets@mail.example.com>`, on a domain verified in Resend. */
  from: string
  replyTo?: string
  baseUrl: string
  timeoutMs: number
}

export class ResendConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResendConfigError'
  }
}

export function loadResendConfig(env: Record<string, string | undefined> = process.env): ResendConfig {
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) throw new ResendConfigError('Missing RESEND_API_KEY')
  if (!apiKey.startsWith('re_')) throw new ResendConfigError('RESEND_API_KEY must be a Resend API key (re_…)')
  const from = env.EMAIL_FROM?.trim()
  if (!from || !/@[^\s>]+\.[^\s>]+>?$/.test(from))
    throw new ResendConfigError('EMAIL_FROM must be an address on a verified domain')
  return {
    apiKey,
    from,
    replyTo: env.EMAIL_REPLY_TO?.trim() || undefined,
    baseUrl: (env.RESEND_BASE_URL ?? 'https://api.resend.com').replace(/\/$/, ''),
    timeoutMs: Number(env.RESEND_TIMEOUT_MS ?? 10_000),
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

interface Attachment {
  filename: string
  /** Base64. */
  content: string
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = RESEND_PROVIDER_NAME

  constructor(
    private readonly cfg: ResendConfig = loadResendConfig(),
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init)
  ) {}

  sendNomineeInvite(email: NomineeInviteEmail): Promise<SendResult> {
    return this.send(email.to, nomineeInviteEmail(email))
  }

  async sendTickets(email: TicketEmail): Promise<SendResult> {
    let attachments: Attachment[]
    try {
      attachments = await Promise.all(
        email.ticketUrls.map(async (url, i) => ({
          filename: `ticket-${i + 1}.png`,
          content: (await QRCode.toBuffer(url, { type: 'png', margin: 2, width: 480 })).toString('base64'),
        }))
      )
    } catch (err) {
      console.error('[email.resend] could not draw ticket QR codes:', err)
      return { sent: false, provider: this.name, reason: 'failed' }
    }
    return this.send(email.to, ticketsEmail(email), { attachments, idempotencyKey: email.idempotencyKey })
  }

  sendTeamInvite(email: TeamInviteEmail): Promise<SendResult> {
    return this.send(email.to, teamInviteEmail(email))
  }

  private async send(
    to: string,
    rendered: RenderedEmail,
    opts: { attachments?: Attachment[]; idempotencyKey?: string } = {}
  ): Promise<SendResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs)
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl}/emails`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
          // Resend drops a repeat with the same key, so a retried confirmation never sends tickets twice.
          ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: this.cfg.from,
          to: [to],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          ...(this.cfg.replyTo ? { reply_to: this.cfg.replyTo } : {}),
          ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
        }),
      })
      if (!res.ok) {
        // Resend's error body names the problem; the address itself is not logged.
        const detail = await res.text().catch(() => '')
        console.error(`[email.resend] ${res.status}: ${detail.slice(0, 300)}`)
        return { sent: false, provider: this.name, reason: 'failed' }
      }
      return { sent: true, provider: this.name }
    } catch (err) {
      console.error('[email.resend] request failed:', err instanceof Error ? err.message : err)
      return { sent: false, provider: this.name, reason: 'failed' }
    } finally {
      clearTimeout(timer)
    }
  }
}
