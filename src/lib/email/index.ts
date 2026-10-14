import type { EmailProvider, NomineeInviteEmail, SendResult } from './provider'

export type { EmailProvider, NomineeInviteEmail, SendResult } from './provider'

/** PLACEHOLDER (#32): prints the email to the server log. Never counts as sent. */
class LogEmailProvider implements EmailProvider {
  readonly name = 'log'
  async sendNomineeInvite(email: NomineeInviteEmail): Promise<SendResult> {
    console.info(
      `[email:log] nominee invite (${email.mode}) → ${email.to}\n  ${email.nomineeName}, ${email.eventTitle} (${email.organizationName})\n  ${email.claimUrl ?? email.signInUrl}`
    )
    return { sent: false, provider: this.name, reason: 'not_configured' }
  }
}

/** No provider at all: same outcome, nothing printed. */
class NullEmailProvider implements EmailProvider {
  readonly name = 'none'
  async sendNomineeInvite(): Promise<SendResult> {
    return { sent: false, provider: this.name, reason: 'not_configured' }
  }
}

export function getEmailProvider(name = process.env.EMAIL_PROVIDER): EmailProvider {
  if (name === 'log') return new LogEmailProvider()
  if (!name && process.env.NODE_ENV !== 'production') return new LogEmailProvider()
  return new NullEmailProvider()
}
