import type { EmailProvider, NomineeInviteEmail, SendResult, TeamInviteEmail, TicketEmail } from './provider'
import { RESEND_PROVIDER_NAME, ResendConfigError, ResendEmailProvider } from './resend'

export type { EmailProvider, NomineeInviteEmail, SendResult, TeamInviteEmail, TicketEmail } from './provider'

/** Development: prints the email to the server log. Never counts as sent. */
class LogEmailProvider implements EmailProvider {
  readonly name = 'log'
  async sendNomineeInvite(email: NomineeInviteEmail): Promise<SendResult> {
    console.info(
      `[email:log] nominee invite (${email.mode}) → ${email.to}\n  ${email.nomineeName}, ${email.eventTitle} (${email.organizationName})\n  ${email.claimUrl ?? email.signInUrl}`
    )
    return { sent: false, provider: this.name, reason: 'not_configured' }
  }
  async sendTickets(email: TicketEmail): Promise<SendResult> {
    console.info(
      `[email:log] tickets → ${email.to}\n  ${email.tierName} × ${email.ticketUrls.length}, ${email.eventTitle}\n  ${email.ticketUrls.join('\n  ')}`
    )
    return { sent: false, provider: this.name, reason: 'not_configured' }
  }
  async sendTeamInvite(email: TeamInviteEmail): Promise<SendResult> {
    console.info(
      `[email:log] team invite → ${email.to}\n  ${email.role} at ${email.organizationName}, from ${email.inviterName}\n  ${email.acceptUrl}`
    )
    return { sent: false, provider: this.name, reason: 'not_configured' }
  }
}

/** No provider at all, or a misconfigured one: same outcome, nothing printed. */
class NullEmailProvider implements EmailProvider {
  constructor(readonly name = 'none') {}
  async sendNomineeInvite(): Promise<SendResult> {
    return { sent: false, provider: this.name, reason: 'not_configured' }
  }
  async sendTickets(): Promise<SendResult> {
    return { sent: false, provider: this.name, reason: 'not_configured' }
  }
  async sendTeamInvite(): Promise<SendResult> {
    return { sent: false, provider: this.name, reason: 'not_configured' }
  }
}

/**
 * `EMAIL_PROVIDER`: `resend` (decision #32), `log` for development, or unset
 * (log in development, nothing in production). A misconfigured Resend logs
 * the reason and sends nothing, so callers fall back as if unconfigured.
 */
export function getEmailProvider(name = process.env.EMAIL_PROVIDER): EmailProvider {
  if (name === RESEND_PROVIDER_NAME) {
    try {
      return new ResendEmailProvider()
    } catch (err) {
      if (!(err instanceof ResendConfigError)) throw err
      console.error(`[email] Resend is not configured: ${err.message}`)
      return new NullEmailProvider('resend-unconfigured')
    }
  }
  if (name === 'log') return new LogEmailProvider()
  if (!name && process.env.NODE_ENV !== 'production') return new LogEmailProvider()
  return new NullEmailProvider()
}
