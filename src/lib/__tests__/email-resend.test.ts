import { describe, expect, test, vi } from 'vitest'
import { getEmailProvider } from '../email'
import { ResendConfigError, ResendEmailProvider, loadResendConfig, type ResendConfig } from '../email/resend'
import { escapeHtml, nomineeInviteEmail, teamInviteEmail, ticketsEmail } from '../email/templates'

const cfg: ResendConfig = {
  apiKey: 're_test_123',
  from: 'voteapp <noreply@mail.example.com>',
  baseUrl: 'https://resend.example',
  timeoutMs: 1000,
}

function stub(status = 200, body: unknown = { id: 'em_1' }) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  })
  return { calls, provider: new ResendEmailProvider(cfg, fetchImpl) }
}

const invite = {
  to: 'ama@example.com',
  nomineeName: 'Ama <b>Owusu</b>',
  eventTitle: 'Faculty Awards',
  organizationName: 'Faculty of Social Sciences',
  mode: 'claim' as const,
  claimUrl: 'https://vote.example/portal/claim/tok',
  signInUrl: 'https://vote.example/login?redirect=/portal',
}

describe('loadResendConfig', () => {
  test('needs a Resend key and a from address', () => {
    expect(() => loadResendConfig({})).toThrow(ResendConfigError)
    expect(() => loadResendConfig({ RESEND_API_KEY: 'sk_x', EMAIL_FROM: 'a@b.co' })).toThrow(/re_/)
    expect(() => loadResendConfig({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'nobody' })).toThrow(/EMAIL_FROM/)
    expect(
      loadResendConfig({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'voteapp <noreply@mail.example.com>' })
    ).toMatchObject({
      baseUrl: 'https://api.resend.com',
    })
  })

  test('a misconfigured Resend sends nothing instead of throwing', async () => {
    const saved = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const provider = getEmailProvider('resend')
    expect(
      await provider.sendTeamInvite({
        to: 'x@y.co',
        organizationName: 'O',
        role: 'staff',
        inviterName: 'I',
        acceptUrl: 'u',
      })
    ).toMatchObject({
      sent: false,
      reason: 'not_configured',
    })
    spy.mockRestore()
    if (saved !== undefined) process.env.RESEND_API_KEY = saved
  })
})

describe('templates', () => {
  test('escape every database value and keep subjects on one line', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
    const claim = nomineeInviteEmail({ ...invite, eventTitle: 'Awards\r\nBcc: evil@x.com' })
    expect(claim.html).toContain('Ama &lt;b&gt;Owusu&lt;/b&gt;')
    expect(claim.html).not.toContain('<b>Owusu')
    expect(claim.subject).not.toMatch(/[\r\n]/)
    expect(claim.text).toContain(invite.claimUrl)
  })

  test('an existing account gets a sign-in link, never a claim link', () => {
    const existing = nomineeInviteEmail({ ...invite, mode: 'existing', claimUrl: null })
    expect(existing.html).toContain(invite.signInUrl.replace(/&/g, '&amp;'))
    expect(existing.text).not.toContain('/portal/claim/')
  })

  test('tickets and team invites carry their links', () => {
    const t = ticketsEmail({
      to: 'b@example.com',
      buyerName: null,
      eventTitle: 'Dinner',
      organizationName: 'Org',
      tierName: 'VIP',
      ticketUrls: ['https://vote.example/t/a', 'https://vote.example/t/b'],
    })
    expect(t.subject).toBe('Your 2 tickets for Dinner')
    expect(t.text).toContain('https://vote.example/t/b')
    const team = teamInviteEmail({
      to: 'c@example.com',
      organizationName: 'Org',
      role: 'scanner',
      inviterName: 'Kofi',
      acceptUrl: 'https://vote.example/team/accept/x',
    })
    expect(team.html).toContain('https://vote.example/team/accept/x')
  })
})

describe('ResendEmailProvider', () => {
  test('posts one email with the key, the from address and both bodies', async () => {
    const { calls, provider } = stub()
    expect(await provider.sendNomineeInvite(invite)).toEqual({ sent: true, provider: 'resend' })
    expect(calls[0].url).toBe('https://resend.example/emails')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_123')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body).toMatchObject({
      from: cfg.from,
      to: ['ama@example.com'],
      subject: 'You have been nominated: Faculty Awards',
    })
    expect(body.html).toContain(invite.claimUrl)
    expect(body.text).toContain(invite.claimUrl)
  })

  test('tickets attach one QR PNG each and carry the idempotency key', async () => {
    const { calls, provider } = stub()
    await provider.sendTickets({
      to: 'b@example.com',
      buyerName: 'Yaw',
      eventTitle: 'Dinner',
      organizationName: 'Org',
      tierName: 'VIP',
      ticketUrls: ['https://vote.example/t/a', 'https://vote.example/t/b'],
      idempotencyKey: 'tickets-pay1',
    })
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('tickets-pay1')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.attachments.map((a: { filename: string }) => a.filename)).toEqual(['ticket-1.png', 'ticket-2.png'])
    const png = Buffer.from(body.attachments[0].content, 'base64')
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  })

  test('a refusal or a network fault is reported, never thrown', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const refused = stub(422, { name: 'validation_error', message: 'domain not verified' }).provider
    expect(
      await refused.sendTeamInvite({
        to: 'x@y.co',
        organizationName: 'O',
        role: 'staff',
        inviterName: 'I',
        acceptUrl: 'u',
      })
    ).toEqual({
      sent: false,
      provider: 'resend',
      reason: 'failed',
    })
    const down = new ResendEmailProvider(cfg, async () => {
      throw new Error('ECONNRESET')
    })
    expect((await down.sendNomineeInvite(invite)).sent).toBe(false)
    spy.mockRestore()
  })
})
