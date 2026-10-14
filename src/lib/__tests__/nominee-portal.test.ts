import { beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
const users = {
  list: vi.fn(),
  create: vi.fn(),
  updatePassword: vi.fn(),
}
const storage = { createFile: vi.fn(), deleteFile: vi.fn() }
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake, users, storage }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))
vi.mock('../photo', async (orig) => ({
  ...(await orig<typeof import('../photo')>()),
  normalizePhoto: async (b: Uint8Array) => new Uint8Array([...new TextEncoder().encode('JPEG:'), ...b]),
}))
vi.mock('node-appwrite/file', () => ({ InputFile: { fromBuffer: (b: Uint8Array, name: string) => ({ b, name }) } }))

import { TenantMismatchError, type TenantContext } from '../db'
import type { EmailProvider } from '../email'
import { createEvent } from '../events-server'
import { ClaimError, claimInvite, claimUrl, inviteNominee } from '../nominee-invite-server'
import { createCategory, createNominee } from '../nominees-server'
import {
  NotOwnNomineeError,
  attachPhoto,
  listOwnNominees,
  photoFileId,
  portalEntries,
  requireOwnNominee,
  updateOwnProfile,
} from '../portal-server'
import { ForbiddenError } from '../tenant'

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const staff: TenantContext = { organizationId: 'org1', userId: 'u2', role: 'staff' }
const otherOrg: TenantContext = { organizationId: 'org2', userId: 'u3', role: 'owner' }

const eventInput = {
  title: 'Faculty Awards',
  votePriceCedis: '1',
  startsAt: '2026-11-01T00:00:00Z',
  endsAt: '2026-11-30T00:00:00Z',
  resultsVisibility: 'hidden',
}

const sentEmails: { to: string; claimUrl: string | null }[] = []
const realEmail: EmailProvider = {
  name: 'test',
  async sendNomineeInvite(e) {
    sentEmails.push({ to: e.to, claimUrl: e.claimUrl })
    return { sent: true, provider: 'test' }
  },
  async sendTickets() {
    return { sent: true, provider: 'test' }
  },
}
const noEmail: EmailProvider = {
  name: 'none',
  async sendNomineeInvite() {
    return { sent: false, provider: 'none', reason: 'not_configured' }
  },
  async sendTickets() {
    return { sent: false, provider: 'none', reason: 'not_configured' }
  },
}

let seedCount = 0
async function seed(email: string | null = 'ama@example.com') {
  const { event } = await createEvent(owner, { ...eventInput, title: `Faculty Awards ${++seedCount}` })
  const category = await createCategory(owner, event.$id, 'Most Influential')
  const { nominee } = await createNominee(owner, {
    eventId: event.$id,
    categoryId: category.$id,
    name: 'Ama Owusu',
    email: email ?? undefined,
  })
  return { event, category, nominee }
}

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  fake = createFakeDatabases(UNIQUE_INDEXES)
  fake.seed('organizations', {
    $id: 'org1',
    name: 'Org 1',
    slug: 'org-1',
    status: 'active',
    moraleCandidatesEnabled: false,
  })
  sentEmails.length = 0
  users.list.mockReset().mockResolvedValue({ total: 0, users: [] })
  users.create.mockReset().mockImplementation(async (id: string) => ({ $id: id }))
  users.updatePassword.mockReset().mockResolvedValue({})
  storage.createFile.mockReset().mockResolvedValue({ $id: 'file_1' })
  storage.deleteFile.mockReset().mockResolvedValue(undefined)
})

describe('createNominee with email', () => {
  test('normalizes and validates the email', async () => {
    const { nominee } = await seed('  Ama@Example.com ')
    expect(nominee.email).toBe('ama@example.com')
    expect(nominee.userId).toBeNull()
    await expect(seed('not-an-email')).rejects.toThrow(/emailInvalid/)
  })
})

describe('inviteNominee', () => {
  test('creates the auth user, stores only the token hash, and sends the claim link', async () => {
    const { nominee } = await seed()
    const out = await inviteNominee(owner, nominee.$id, { email: realEmail, baseUrl: 'https://vote.example' })
    expect(users.create).toHaveBeenCalledTimes(1)
    expect(out.emailSent).toBe(true)
    expect(out.claimUrl).toBeNull()
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].to).toBe('ama@example.com')
    expect(sentEmails[0].claimUrl ?? '').toMatch(/^https:\/\/vote\.example\/portal\/claim\/[A-Za-z0-9_-]{32,}$/)

    const row = await fake.getDocument('voteapp', 'nominees', nominee.$id)
    expect(row.userId).toBeTruthy()
    expect(row.inviteTokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(row.inviteSentAt).toBeTruthy()
    expect(JSON.stringify(row)).not.toContain((sentEmails[0].claimUrl ?? '').split('/').pop())
    expect(fake.dump('audit_logs').map((l) => l.action)).toContain('nominee.invite')
  })

  test('hands the link back when email is not configured, without marking it sent', async () => {
    const { nominee } = await seed()
    const out = await inviteNominee(owner, nominee.$id, { email: noEmail })
    expect(out.emailSent).toBe(false)
    expect(out.claimUrl).toMatch(/\/portal\/claim\//)
    expect((await fake.getDocument('voteapp', 'nominees', nominee.$id)).inviteSentAt).toBeNull()
  })

  test('an existing account is linked, never given a claim token, and cannot be password-reset', async () => {
    users.list.mockResolvedValue({ total: 1, users: [{ $id: 'existing_user' }] })
    const { nominee } = await seed()
    const out = await inviteNominee(owner, nominee.$id, { email: noEmail })
    expect(users.create).not.toHaveBeenCalled()
    expect(out.mode).toBe('existing')
    expect(out.claimUrl).toBeNull()
    const row = await fake.getDocument('voteapp', 'nominees', nominee.$id)
    expect(row.userId).toBe('existing_user')
    expect(row.inviteTokenHash).toBeNull()
    expect(row.claimedAt).toBeTruthy()
    // Re-inviting cannot mint a token for it either.
    await expect(inviteNominee(owner, nominee.$id, { email: noEmail })).rejects.toThrow(/alreadyClaimed/)
    expect(users.updatePassword).not.toHaveBeenCalled()
    const log = fake.dump('audit_logs').find((l) => l.action === 'nominee.invite')
    expect(JSON.parse(log!.metadata as string)).toMatchObject({ mode: 'existing' })
  })

  test('the existing-account email says to sign in rather than carrying a link', async () => {
    users.list.mockResolvedValue({ total: 1, users: [{ $id: 'existing_user' }] })
    const { nominee } = await seed()
    const modes: string[] = []
    const spy: EmailProvider = {
      name: 'spy',
      async sendNomineeInvite(e) {
        modes.push(`${e.mode}:${e.claimUrl ?? 'none'}:${e.signInUrl}`)
        return { sent: true, provider: 'spy' }
      },
      async sendTickets() {
        return { sent: false, provider: 'spy', reason: 'not_configured' }
      },
    }
    await inviteNominee(owner, nominee.$id, { email: spy, baseUrl: 'https://vote.example' })
    expect(modes).toEqual(['existing:none:https://vote.example/login?redirect=/portal'])
  })

  test('refuses a nominee from another event before doing any work', async () => {
    const { nominee } = await seed()
    const other = await seed()
    await expect(
      inviteNominee(owner, nominee.$id, { email: realEmail, expectedEventId: other.event.$id })
    ).rejects.toThrow(/wrongEvent/)
    expect(users.create).not.toHaveBeenCalled()
    expect(sentEmails).toHaveLength(0)
    expect((await fake.getDocument('voteapp', 'nominees', nominee.$id)).inviteTokenHash).toBeNull()
  })

  test('re-inviting rotates the token so the old link dies', async () => {
    const { nominee } = await seed()
    const first = await inviteNominee(owner, nominee.$id, { email: noEmail })
    const second = await inviteNominee(owner, nominee.$id, { email: noEmail })
    const oldToken = first.claimUrl!.split('/').pop()!
    await expect(claimInvite(oldToken, 'password123')).rejects.toThrow(/invalid/)
    await expect(claimInvite(second.claimUrl!.split('/').pop()!, 'password123')).resolves.toMatchObject({
      email: 'ama@example.com',
    })
  })

  test('refuses without email, after claim, for staff and for other tenants', async () => {
    const { nominee } = await seed(null)
    await expect(inviteNominee(owner, nominee.$id, { email: noEmail })).rejects.toThrow(/noEmail/)
    const withEmail = await seed()
    await expect(inviteNominee(staff, withEmail.nominee.$id, { email: noEmail })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(inviteNominee(otherOrg, withEmail.nominee.$id, { email: noEmail })).rejects.toBeInstanceOf(
      TenantMismatchError
    )
    const out = await inviteNominee(owner, withEmail.nominee.$id, { email: noEmail })
    await claimInvite(out.claimUrl!.split('/').pop()!, 'password123')
    await expect(inviteNominee(owner, withEmail.nominee.$id, { email: noEmail })).rejects.toThrow(/alreadyClaimed/)
  })
})

describe('claimInvite', () => {
  test('sets the password, burns the token and audits', async () => {
    const { nominee } = await seed()
    const { claimUrl: url } = await inviteNominee(owner, nominee.$id, { email: noEmail })
    const token = url!.split('/').pop()!
    const result = await claimInvite(token, 'password123')
    expect(result.email).toBe('ama@example.com')
    expect(users.updatePassword).toHaveBeenCalledWith(expect.any(String), 'password123')
    const row = await fake.getDocument('voteapp', 'nominees', nominee.$id)
    expect(row.claimedAt).toBeTruthy()
    expect(row.inviteTokenHash).toBeNull()
    await expect(claimInvite(token, 'password123')).rejects.toThrow(/invalid/)
    expect(fake.dump('audit_logs').map((l) => l.action)).toContain('nominee.claim')
  })

  test('rejects short passwords, bad tokens and expired links', async () => {
    const { nominee } = await seed()
    const { claimUrl: url } = await inviteNominee(owner, nominee.$id, { email: noEmail })
    const token = url!.split('/').pop()!
    await expect(claimInvite(token, 'short')).rejects.toThrow(/passwordTooShort/)
    await expect(claimInvite('nope', 'password123')).rejects.toBeInstanceOf(ClaimError)
    await fake.updateDocument('voteapp', 'nominees', nominee.$id, { inviteExpiresAt: '2020-01-01T00:00:00Z' })
    await expect(claimInvite(token, 'password123')).rejects.toThrow(/expired/)
    expect(users.updatePassword).not.toHaveBeenCalled()
  })
})

describe('portal access (own row only)', () => {
  async function claimed() {
    const { nominee, event, category } = await seed()
    const { claimUrl: url } = await inviteNominee(owner, nominee.$id, { email: noEmail })
    await claimInvite(url!.split('/').pop()!, 'password123')
    const row = await fake.getDocument('voteapp', 'nominees', nominee.$id)
    return { nominee: row, event, category, userId: row.userId as string }
  }

  test("lists and resolves only the caller's nominees", async () => {
    const { nominee, userId, event, category } = await claimed()
    expect((await listOwnNominees(userId)).map((n) => n.$id)).toEqual([nominee.$id])
    expect(await listOwnNominees('someone_else')).toEqual([])
    await expect(requireOwnNominee(userId, nominee.$id)).resolves.toMatchObject({ $id: nominee.$id })
    await expect(requireOwnNominee('someone_else', nominee.$id)).rejects.toBeInstanceOf(NotOwnNomineeError)
    await expect(requireOwnNominee(userId, 'missing')).rejects.toBeInstanceOf(NotOwnNomineeError)
    await expect(requireOwnNominee('', nominee.$id)).rejects.toBeInstanceOf(NotOwnNomineeError)

    const entries = await portalEntries(userId)
    expect(entries).toHaveLength(1)
    expect(entries[0].event?.title).toBe(event.title)
    expect(entries[0].category?.name).toBe(category.name)
    expect(entries[0].organizationSlug).toBe('org-1')
  })

  test('profile edits are validated and scoped to the owner', async () => {
    const { nominee, userId } = await claimed()
    const updated = await updateOwnProfile(userId, nominee.$id, { name: '  Ama  Serwaa ', bio: 'Hi' })
    expect(updated.name).toBe('Ama Serwaa')
    expect(updated.bio).toBe('Hi')
    await expect(updateOwnProfile(userId, nominee.$id, { name: 'A' })).rejects.toThrow(/nameTooShort/)
    await expect(updateOwnProfile('someone_else', nominee.$id, { name: 'Hacker' })).rejects.toBeInstanceOf(
      NotOwnNomineeError
    )
    expect((await fake.getDocument('voteapp', 'nominees', nominee.$id)).name).toBe('Ama Serwaa')
  })

  test('photo upload stores a normalized public file and completes the profile', async () => {
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1'
    process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'proj'
    const { nominee, userId } = await claimed()
    const updated = await attachPhoto(userId, nominee.$id, new TextEncoder().encode('rawbytes'))
    expect(storage.createFile).toHaveBeenCalledTimes(1)
    const [bucket, , file, permissions] = storage.createFile.mock.calls[0]
    expect(bucket).toBe('nominee-photos')
    expect(new TextDecoder().decode(file.b)).toBe('JPEG:rawbytes')
    expect(file.name).toBe(`${nominee.code}.jpg`)
    expect(permissions).toEqual(['read("any")'])
    expect(updated.photoUrl).toBe(
      'https://fra.cloud.appwrite.io/v1/storage/buckets/nominee-photos/files/file_1/view?project=proj'
    )
    expect(updated.profileCompletedAt).toBeTruthy()
    await expect(attachPhoto('someone_else', nominee.$id, new Uint8Array([1]))).rejects.toBeInstanceOf(
      NotOwnNomineeError
    )

    // Replacing the photo removes the old file.
    storage.createFile.mockResolvedValueOnce({ $id: 'file_2' })
    const replaced = await attachPhoto(userId, nominee.$id, new Uint8Array([2]))
    expect(replaced.photoUrl).toContain('/files/file_2/view')
    expect(storage.deleteFile).toHaveBeenCalledWith('nominee-photos', 'file_1')
    expect(photoFileId(replaced.photoUrl)).toBe('file_2')
    expect(photoFileId(null)).toBeNull()
  })
})

describe('claimUrl', () => {
  test('builds from the app url without a double slash', () => {
    expect(claimUrl('tok', 'https://vote.example/')).toBe('https://vote.example/portal/claim/tok')
  })
})
