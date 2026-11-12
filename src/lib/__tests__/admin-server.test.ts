import { beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import {
  ADMIN_PAGE_SIZE,
  AdminError,
  findTransaction,
  getOrganizationDetail,
  listAuditPage,
  listOrganizationsPage,
  listTransactionsPage,
  parseSettingsPatch,
  platformOverview,
  updateOrganizationSettings,
} from '../admin-server'

function org(id: string, extra: Record<string, unknown> = {}) {
  fake.seed('organizations', {
    $id: id,
    name: `Org ${id}`,
    slug: `org-${id}`,
    logoUrl: null,
    brandColors: null,
    status: 'active',
    commissionRate: null,
    moraleCandidatesEnabled: true,
    freeVotesEnabled: true,
    ...extra,
  })
}

function payment(id: string, organizationId: string, extra: Record<string, unknown> = {}) {
  fake.seed('payments', {
    $id: id,
    organizationId,
    eventId: 'e1',
    purpose: 'vote',
    channel: 'web',
    status: 'success',
    provider: 'paystack',
    providerReference: `ref_${id}`,
    payerPhone: '233241234567',
    network: 'mtn',
    quantity: 1,
    amount: 100,
    platformFee: 10,
    organizerNet: 90,
    confirmedAt: null,
    ...extra,
  })
}

const audits = async () => (await fake.listDocuments('voteapp', 'audit_logs', [])).documents

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  fake = createFakeDatabases({ ...UNIQUE_INDEXES })
  org('a')
  org('b', { status: 'suspended' })
})

describe('parseSettingsPatch', () => {
  test('accepts known fields with valid values', () => {
    expect(parseSettingsPatch({ commissionRate: 750, freeVotesEnabled: false })).toEqual({
      commissionRate: 750,
      freeVotesEnabled: false,
    })
    expect(parseSettingsPatch({ commissionRate: null })).toEqual({ commissionRate: null })
  })

  test('rejects bad values and a suspension without a reason', () => {
    for (const body of [
      null,
      { status: 'deleted' },
      { commissionRate: 10_001 },
      { commissionRate: 7.5 },
      { commissionRate: '750' },
      { moraleCandidatesEnabled: 'no' },
      { status: 'suspended' },
      { status: 'suspended', reason: '   ' },
    ]) {
      expect(() => parseSettingsPatch(body), JSON.stringify(body)).toThrow(AdminError)
    }
    expect(parseSettingsPatch({ status: 'suspended', reason: ' fraud report ' })).toEqual({
      status: 'suspended',
      reason: 'fraud report',
    })
  })
})

describe('updateOrganizationSettings', () => {
  test('suspends with an audit row holding before, after and the reason', async () => {
    const updated = await updateOrganizationSettings('admin1', 'a', { status: 'suspended', reason: 'chargebacks' })
    expect(updated.status).toBe('suspended')
    const [row] = await audits()
    expect(row).toMatchObject({
      actorId: 'admin1',
      organizationId: 'a',
      action: 'organization.suspend',
      target: 'organizations/a',
    })
    expect(JSON.parse(row.metadata as string)).toEqual({
      before: { status: 'active' },
      after: { status: 'suspended' },
      reason: 'chargebacks',
    })
  })

  test('reactivates', async () => {
    await updateOrganizationSettings('admin1', 'b', { status: 'active' })
    expect((await audits())[0].action).toBe('organization.reactivate')
  })

  test('records only what changed', async () => {
    await updateOrganizationSettings('admin1', 'a', {
      commissionRate: 500,
      moraleCandidatesEnabled: true,
      freeVotesEnabled: false,
    })
    const [row] = await audits()
    expect(row.action).toBe('organization.settings')
    expect(JSON.parse(row.metadata as string)).toEqual({
      before: { commissionRate: null, freeVotesEnabled: true },
      after: { commissionRate: 500, freeVotesEnabled: false },
    })
    expect((await fake.getDocument('voteapp', 'organizations', 'a')).commissionRate).toBe(500)
  })

  test('back to the platform rate', async () => {
    org('c', { commissionRate: 500 })
    await updateOrganizationSettings('admin1', 'c', { commissionRate: null })
    expect((await fake.getDocument('voteapp', 'organizations', 'c')).commissionRate).toBeNull()
  })

  test('writes nothing when the transaction fails', async () => {
    fake.createDocument.mockImplementationOnce(async () => {
      throw Object.assign(new Error('audit write failed'), { code: 500 })
    })
    await expect(updateOrganizationSettings('admin1', 'a', { freeVotesEnabled: false })).rejects.toThrow()
    expect((await fake.getDocument('voteapp', 'organizations', 'a')).freeVotesEnabled).toBe(true)
    expect(await audits()).toHaveLength(0)
  })

  test('refuses a no-op and an unknown organization, writing nothing', async () => {
    await expect(updateOrganizationSettings('admin1', 'a', { status: 'active' })).rejects.toMatchObject({
      problem: 'noChange',
    })
    await expect(updateOrganizationSettings('admin1', 'zzz', { status: 'active' })).rejects.toMatchObject({
      problem: 'notFound',
    })
    expect(await audits()).toHaveLength(0)
  })
})

describe('lists', () => {
  test('organizations by status and slug prefix', async () => {
    expect((await listOrganizationsPage({ status: 'suspended' })).items.map((o) => o.$id)).toEqual(['b'])
    expect((await listOrganizationsPage({ search: 'ORG-A' })).items.map((o) => o.$id)).toEqual(['a'])
  })

  test('pages with a cursor', async () => {
    for (let i = 0; i < ADMIN_PAGE_SIZE + 3; i++) payment(`p${String(i).padStart(2, '0')}`, 'a')
    const first = await listTransactionsPage()
    expect(first.items).toHaveLength(ADMIN_PAGE_SIZE)
    expect(first.next).not.toBeNull()
    const second = await listTransactionsPage({}, first.next)
    expect(second.items).toHaveLength(3)
    expect(second.next).toBeNull()
    const ids = [...first.items, ...second.items].map((p) => p.id)
    expect(new Set(ids).size).toBe(ADMIN_PAGE_SIZE + 3)
  })

  test('transactions filter and mask the payer phone', async () => {
    payment('p1', 'a')
    payment('p2', 'b', { status: 'pending' })
    const page = await listTransactionsPage({ status: 'pending' })
    expect(page.items.map((p) => p.id)).toEqual(['p2'])
    expect(page.items[0].payerPhone).toBe('•••••••••567')
    expect(JSON.stringify(page.items[0])).not.toContain('233241234567')
    expect((await listTransactionsPage({ organizationId: 'a' })).items.map((p) => p.id)).toEqual(['p1'])
  })

  test('finds a payment by id or provider reference', async () => {
    payment('p1', 'a')
    expect((await findTransaction('p1'))?.id).toBe('p1')
    expect((await findTransaction(' ref_p1 '))?.id).toBe('p1')
    expect(await findTransaction('nope')).toBeNull()
    expect(await findTransaction('')).toBeNull()
  })

  test('audit log by organization', async () => {
    await updateOrganizationSettings('admin1', 'a', { freeVotesEnabled: false })
    await updateOrganizationSettings('admin1', 'b', { status: 'active' })
    expect((await listAuditPage({ organizationId: 'b' })).items.map((r) => r.action)).toEqual([
      'organization.reactivate',
    ])
    expect((await listAuditPage()).items).toHaveLength(2)
  })

  test('overview counts', async () => {
    payment('p1', 'a', { status: 'pending' })
    expect(await platformOverview()).toEqual({ organizations: 2, suspended: 1, pendingPayouts: 0, pendingPayments: 1 })
  })

  test('organization detail: owners, events and balance', async () => {
    fake.seed('memberships', { $id: 'm1', organizationId: 'a', userId: 'u1', role: 'owner' })
    fake.seed('memberships', { $id: 'm2', organizationId: 'a', userId: 'u2', role: 'staff' })
    fake.seed('users', {
      $id: 'u1',
      email: 'owner@example.com',
      fullName: 'Owner One',
      phone: null,
      isSuperAdmin: false,
    })
    fake.seed('events', { $id: 'e1', organizationId: 'a', title: 'Awards', slug: 'awards', status: 'live' })
    fake.seed('ledger_entries', {
      $id: 'l1',
      organizationId: 'a',
      type: 'vote_credit',
      amount: 900,
      paymentId: 'p1',
      note: null,
    })
    fake.seed('ledger_entries', {
      $id: 'l2',
      organizationId: 'b',
      type: 'vote_credit',
      amount: 5000,
      paymentId: 'p9',
      note: null,
    })
    const detail = await getOrganizationDetail('a')
    expect(detail.owners).toEqual([{ userId: 'u1', name: 'Owner One', email: 'owner@example.com' }])
    expect(detail.members).toBe(2)
    expect(detail.events.map((e) => e.title)).toEqual(['Awards'])
    expect(detail.balance.available).toBe(900)
    await expect(getOrganizationDetail('zzz')).rejects.toMatchObject({ problem: 'notFound' })
  })
})
