/**
 * Transactional email boundary. Resend is the provider (decided 2026-11-12,
 * #32); `log` prints emails in development. Callers must still cope with
 * `sent: false` by offering another way to deliver the content.
 */
export interface NomineeInviteEmail {
  to: string
  nomineeName: string
  eventTitle: string
  organizationName: string
  /** `claim`: a new account, set a password via `claimUrl`. `existing`: the email already has an account; sign in as usual. */
  mode: 'claim' | 'existing'
  claimUrl: string | null
  signInUrl: string
}

export interface SendResult {
  sent: boolean
  provider: string
  /** Why it was not sent, for the organizer UI. */
  reason?: 'not_configured' | 'failed'
}

export interface TicketEmail {
  to: string
  buyerName: string | null
  eventTitle: string
  organizationName: string
  tierName: string
  /** One public link per ticket, each showing its QR code. */
  ticketUrls: string[]
  /** Lets the provider drop a repeat send for the same purchase. */
  idempotencyKey?: string
}

export interface TeamInviteEmail {
  to: string
  organizationName: string
  role: string
  inviterName: string
  acceptUrl: string
}

export interface EmailProvider {
  readonly name: string
  sendNomineeInvite(email: NomineeInviteEmail): Promise<SendResult>
  sendTickets(email: TicketEmail): Promise<SendResult>
  sendTeamInvite(email: TeamInviteEmail): Promise<SendResult>
}
