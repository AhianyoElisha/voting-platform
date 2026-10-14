/**
 * Transactional email boundary. The provider is OPEN_QUESTIONS #32; until it
 * is settled only the `log` adapter exists, and callers must cope with
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

export interface EmailProvider {
  readonly name: string
  sendNomineeInvite(email: NomineeInviteEmail): Promise<SendResult>
}
