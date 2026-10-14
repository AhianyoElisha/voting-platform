import { beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import type { TenantContext } from '../db'
import type { EmailProvider } from '../email'
import {
  TeamError,
  acceptInvite,
  changeRole,
  inviteMember,
  listInvites,
  listMembers,
  removeMember,
  resendInvite,
  revokeInvite,
} from '../team-server'
import { ForbiddenError } from '../tenant'

const owner: TenantContext = { organizationId: 'org1', userId: 'u_owner', role: 'owner' }
const admin: TenantContext = { organizationId: 'org1', userId: 'u_admin', role: 'admin' }
const staff: TenantContext = { organizationId: 'org1', userId: 'u_staff', role: 'staff' }
const otherOrg: TenantContext = { organizationId: 'org2', userId: 'u_other', role: 'owner' }

const sent: string[] = []
const noEmail: EmailProvider = {
  name: 'none',
  async sendNomineeInvite() {
    return { sent: false, provider: 'none', reason: 'not_configured' }
  },
  async sendTickets() {
    return { sent: false, provider: 'none', reason: 'not_configured' }
  },
  async sendTeamInvite(e) {
    sent.push(e.acceptUrl)
    return { sent: false, provider: 'none', reason: 'not_configured' }
  },
}
const tokenOf = (url: string | null) => url!.split('/').pop()!

function seedUser(id: string, email: string) {
  fake.seed('users', { $id: id, email, fullName: id, phone: null, isSuperAdmin: false })
}
function seedMember(id: string, org: string, role: string, userId: string) {
  fake.seed('memberships', { $id: id, organizationId: org, userId, role })
}

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  fake = createFakeDatabases(UNIQUE_INDEXES)
  fake.seed('organizations', { $id: 'org1', name: 'Org 1', slug: 'org-1', status: 'active' })
  seedUser('u_owner', 'owner@example.com')
  seedUser('u_admin', 'admin@example.com')
  seedUser('u_staff', 'staff@example.com')
  seedUser('u_new', 'new@example.com')
  seedMember('m_owner', 'org1', 'owner', 'u_owner')
  seedMember('m_admin', 'org1', 'admin', 'u_admin')
  seedMember('m_staff', 'org1', 'staff', 'u_staff')
  sent.length = 0
})

describe('inviteMember', () => {
  test('stores only the token hash, returns the link when email is off, and audits', async () => {
    const out = await inviteMember(
      admin,
      { email: ' New@Example.com ', role: 'scanner' },
      { email: noEmail, baseUrl: 'https://vote.example' }
    )
    expect(out.invite).toMatchObject({
      email: 'new@example.com',
      role: 'scanner',
      status: 'pending',
      organizationId: 'org1',
      invitedBy: 'u_admin',
    })
    expect(out.invite.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(out.acceptUrl).toMatch(/^https:\/\/vote\.example\/team\/accept\/[A-Za-z0-9_-]{32,}$/)
    expect(JSON.stringify(out.invite)).not.toContain(tokenOf(out.acceptUrl))
    expect(fake.dump('audit_logs').map((l) => l.action)).toEqual(['team.invite'])
  })

  test('refuses owner role, bad roles, bad emails, existing members, duplicate pending invites, staff and other tenants', async () => {
    await expect(inviteMember(owner, { email: 'x@example.com', role: 'owner' }, { email: noEmail })).rejects.toThrow(
      /roleInvalid/
    )
    await expect(inviteMember(owner, { email: 'x@example.com', role: 'king' }, { email: noEmail })).rejects.toThrow(
      /roleInvalid/
    )
    await expect(inviteMember(owner, { email: 'nope', role: 'staff' }, { email: noEmail })).rejects.toThrow(
      /emailInvalid/
    )
    await expect(
      inviteMember(owner, { email: 'staff@example.com', role: 'admin' }, { email: noEmail })
    ).rejects.toThrow(/alreadyMember/)
    await inviteMember(owner, { email: 'new@example.com', role: 'staff' }, { email: noEmail })
    await expect(inviteMember(owner, { email: 'new@example.com', role: 'admin' }, { email: noEmail })).rejects.toThrow(
      /alreadyInvited/
    )
    await expect(
      inviteMember(staff, { email: 'y@example.com', role: 'staff' }, { email: noEmail })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect((await listInvites(otherOrg)).length).toBe(0)
  })
})

describe('acceptInvite', () => {
  test('creates the membership for the invited email only, once', async () => {
    const out = await inviteMember(owner, { email: 'new@example.com', role: 'designer' }, { email: noEmail })
    const token = tokenOf(out.acceptUrl)
    seedUser('u_wrong', 'wrong@example.com')
    await expect(acceptInvite('u_wrong', token)).rejects.toThrow(/emailMismatch/)
    await expect(acceptInvite('nobody', token)).rejects.toThrow(/emailMismatch/)
    expect(fake.dump('memberships')).toHaveLength(3)

    const { membership, invite } = await acceptInvite('u_new', token)
    expect(membership).toMatchObject({ userId: 'u_new', organizationId: 'org1', role: 'designer' })
    expect(invite).toMatchObject({ status: 'accepted', acceptedBy: 'u_new', tokenHash: null })
    await expect(acceptInvite('u_new', token)).rejects.toThrow(/tokenInvalid|tokenUsed/)
    expect(fake.dump('memberships')).toHaveLength(4)
    expect((await listMembers(owner)).find((m) => m.membership.userId === 'u_new')?.user?.email).toBe('new@example.com')
  })

  test('rejects bad, expired, revoked and resent-over tokens', async () => {
    const out = await inviteMember(owner, { email: 'new@example.com', role: 'staff' }, { email: noEmail })
    const first = tokenOf(out.acceptUrl)
    await expect(acceptInvite('u_new', 'junk')).rejects.toThrow(/tokenInvalid/)
    await fake.updateDocument('voteapp', 'team_invites', out.invite.$id, { expiresAt: '2020-01-01T00:00:00Z' })
    await expect(acceptInvite('u_new', first)).rejects.toThrow(/tokenExpired/)
    const resent = await resendInvite(owner, out.invite.$id, { email: noEmail })
    await expect(acceptInvite('u_new', first)).rejects.toThrow(/tokenInvalid/)
    await revokeInvite(owner, out.invite.$id)
    await expect(acceptInvite('u_new', tokenOf(resent.acceptUrl))).rejects.toThrow(/tokenInvalid/)
    await expect(revokeInvite(owner, out.invite.$id)).rejects.toThrow(/notPending/)
    expect(fake.dump('memberships')).toHaveLength(3)
  })
})

describe('integrity review fix', () => {
  test('accepting in two tabs at once creates one membership and does not crash', async () => {
    const out = await inviteMember(owner, { email: 'new@example.com', role: 'staff' }, { email: noEmail })
    const token = tokenOf(out.acceptUrl)
    const results = await Promise.allSettled([acceptInvite('u_new', token), acceptInvite('u_new', token)])
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
    expect(fake.dump('memberships').filter((m) => m.userId === 'u_new')).toHaveLength(1)
  })
})

describe('roles and removal', () => {
  test('admins change non-owner roles; owners are immutable here; nobody changes their own', async () => {
    const changed = await changeRole(admin, 'm_staff', 'scanner')
    expect(changed.role).toBe('scanner')
    await expect(changeRole(admin, 'm_owner', 'staff')).rejects.toThrow(/ownerImmutable/)
    await expect(changeRole(owner, 'm_staff', 'owner')).rejects.toThrow(/roleInvalid/)
    await expect(changeRole(admin, 'm_admin', 'staff')).rejects.toThrow(/selfChange/)
    await expect(changeRole(staff, 'm_admin', 'staff')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(changeRole(otherOrg, 'm_staff', 'admin')).rejects.toThrow()
  })

  test('removal keeps at least one owner and never removes yourself', async () => {
    await removeMember(admin, 'm_staff')
    expect(
      fake
        .dump('memberships')
        .map((m) => m.$id)
        .sort()
    ).toEqual(['m_admin', 'm_owner'])
    await expect(removeMember(admin, 'm_owner')).rejects.toThrow(/ownerImmutable/)
    await expect(removeMember(owner, 'm_owner')).rejects.toThrow(/selfChange/)
    seedMember('m_owner2', 'org1', 'owner', 'u_owner2')
    await removeMember(owner, 'm_owner2')
    seedMember('m_owner3', 'org1', 'owner', 'u_owner3')
    const ctx3: TenantContext = { organizationId: 'org1', userId: 'u_owner3', role: 'owner' }
    await removeMember(ctx3, 'm_owner')
    await expect(removeMember(admin, 'm_owner3')).rejects.toThrow(/ownerImmutable/)
    await expect(removeMember(otherOrg, 'm_admin')).rejects.toThrow()
    expect(fake.dump('audit_logs').filter((l) => l.action === 'team.remove')).toHaveLength(3)
  })

  test('the last owner cannot be removed by another owner either', async () => {
    seedMember('m_owner2', 'org1', 'owner', 'u_owner2')
    const ctx2: TenantContext = { organizationId: 'org1', userId: 'u_owner2', role: 'owner' }
    await removeMember(ctx2, 'm_owner')
    const ctx1Again: TenantContext = { organizationId: 'org1', userId: 'u_ghost', role: 'owner' }
    await expect(removeMember(ctx1Again, 'm_owner2')).rejects.toThrow(/lastOwner/)
    expect(() => new TeamError('lastOwner')).not.toThrow()
  })
})
