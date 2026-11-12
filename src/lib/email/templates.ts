import type { NomineeInviteEmail, TeamInviteEmail, TicketEmail } from './provider'

/**
 * The transactional emails as subject, HTML and plain text. Pure, so the
 * wording is testable and any provider can send them. Every value from the
 * database is HTML-escaped; links are only ever our own app URLs.
 *
 * The product name is still the `voteapp` placeholder (OPEN_QUESTIONS #1).
 */
export const PRODUCT_NAME = 'voteapp'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** One-line subjects: no line breaks from user-supplied names. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function layout(paragraphs: string[], button?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join('')
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#4f46e5;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a></p>`
    : ''
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:Poppins,Arial,sans-serif;color:#171717;font-size:15px;line-height:1.5"><div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">${body}${cta}<p style="margin:24px 0 0;font-size:12px;color:#737373">Sent by ${PRODUCT_NAME}. If you were not expecting this email, you can ignore it.</p></div></body></html>`
}

export function nomineeInviteEmail(email: NomineeInviteEmail): RenderedEmail {
  const name = escapeHtml(email.nomineeName)
  const event = escapeHtml(email.eventTitle)
  const org = escapeHtml(email.organizationName)
  const subject = oneLine(`You have been nominated: ${email.eventTitle}`)
  if (email.mode === 'claim' && email.claimUrl) {
    return {
      subject,
      html: layout(
        [
          `Hello ${name},`,
          `${org} has nominated you in <strong>${event}</strong>. Set a password to open your nominee portal, where you can upload your photo and download your campaign flyer.`,
          `The link works once and expires in a few days. If it has expired, ask the organizer for a new one.`,
        ],
        { label: 'Set up my portal', url: email.claimUrl }
      ),
      text: `Hello ${email.nomineeName},\n\n${email.organizationName} has nominated you in ${email.eventTitle}. Set a password to open your nominee portal, where you can upload your photo and download your campaign flyer:\n\n${email.claimUrl}\n\nThe link works once and expires in a few days.\n`,
    }
  }
  return {
    subject,
    html: layout(
      [
        `Hello ${name},`,
        `${org} has nominated you in <strong>${event}</strong>. You already have an account with this email address, so sign in as usual to open your nominee portal.`,
      ],
      { label: 'Sign in', url: email.signInUrl }
    ),
    text: `Hello ${email.nomineeName},\n\n${email.organizationName} has nominated you in ${email.eventTitle}. Sign in with this email address to open your nominee portal:\n\n${email.signInUrl}\n`,
  }
}

export function ticketsEmail(email: TicketEmail): RenderedEmail {
  const count = email.ticketUrls.length
  const greeting = email.buyerName ? `Hello ${escapeHtml(email.buyerName)},` : 'Hello,'
  const links = email.ticketUrls.map((url, i) => `<a href="${escapeHtml(url)}">Ticket ${i + 1}</a>`).join('<br>')
  return {
    subject: oneLine(`Your ${count === 1 ? 'ticket' : `${count} tickets`} for ${email.eventTitle}`),
    html: layout([
      greeting,
      `Thank you for your purchase: ${count} × ${escapeHtml(email.tierName)} for <strong>${escapeHtml(email.eventTitle)}</strong> (${escapeHtml(email.organizationName)}).`,
      `Each ticket's QR code is attached. Show it at the entrance, on your phone or printed. Each code works once. You can also open them here:<br>${links}`,
      `Keep this email private: anyone with a ticket's code can use it.`,
    ]),
    text: `${email.buyerName ? `Hello ${email.buyerName},` : 'Hello,'}\n\nThank you for your purchase: ${count} × ${email.tierName} for ${email.eventTitle} (${email.organizationName}).\n\nEach ticket's QR code is attached. Show it at the entrance; each code works once. Your tickets:\n${email.ticketUrls.join('\n')}\n\nKeep this email private: anyone with a ticket's code can use it.\n`,
  }
}

export function teamInviteEmail(email: TeamInviteEmail): RenderedEmail {
  const org = escapeHtml(email.organizationName)
  return {
    subject: oneLine(`Join ${email.organizationName} on ${PRODUCT_NAME}`),
    html: layout(
      [
        `${escapeHtml(email.inviterName)} has invited you to join <strong>${org}</strong> as ${escapeHtml(email.role)}.`,
        `The link works once. If it has expired, ask for a new invite.`,
      ],
      { label: 'Accept the invite', url: email.acceptUrl }
    ),
    text: `${email.inviterName} has invited you to join ${email.organizationName} as ${email.role}.\n\nAccept the invite:\n${email.acceptUrl}\n`,
  }
}
