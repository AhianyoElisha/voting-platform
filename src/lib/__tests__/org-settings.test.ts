import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
let fileSeq = 0
const storage = {
  createFile: vi.fn(async () => ({ $id: `file${++fileSeq}` })),
  deleteFile: vi.fn(async () => ({})),
}
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake, storage }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))
vi.mock('node-appwrite/file', () => ({ InputFile: { fromBuffer: (b: Uint8Array, name: string) => ({ b, name }) } }))

import { luminance, parseBrandColors, serializeBrandColors, textColorOn } from '../branding'
import type { TenantContext } from '../db'
import { solidPng } from '../flyer/render'
import { logoFileId, setOrganizationLogo, updateOrganizationProfile } from '../organizations-server'
import { ForbiddenError } from '../tenant'

const owner: TenantContext = { organizationId: 'org1', userId: 'u1', role: 'owner' }
const audits = async () => (await fake.listDocuments('voteapp', 'audit_logs', [])).documents
const org = async () => fake.getDocument('voteapp', 'organizations', 'org1')

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1'
  process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = 'proj'
  fake = createFakeDatabases({ ...UNIQUE_INDEXES })
  storage.createFile.mockClear()
  storage.deleteFile.mockClear()
  fake.seed('organizations', {
    $id: 'org1',
    name: 'Faculty of Social Sciences',
    slug: 'fss',
    status: 'active',
    logoUrl: null,
    brandColors: null,
    commissionRate: null,
    moraleCandidatesEnabled: true,
    freeVotesEnabled: true,
  })
})

describe('branding helpers', () => {
  it('round-trips colours and rejects malformed JSON', () => {
    const raw = serializeBrandColors({ primary: '#1E3A8A', accent: null })
    expect(parseBrandColors(raw)).toEqual({ primary: '#1e3a8a', accent: null })
    expect(parseBrandColors('{"primary":"blue"}')).toBeNull()
    expect(parseBrandColors('not json')).toBeNull()
    expect(parseBrandColors(null)).toBeNull()
  })

  it('picks readable text for the band', () => {
    expect(textColorOn('#1e3a8a')).toBe('#ffffff') // dark blue
    expect(textColorOn('#fde047')).toBe('#111827') // yellow
    expect(textColorOn('#ffffff')).toBe('#111827')
    expect(luminance('#000000')).toBe(0)
  })
})

describe('updateOrganizationProfile', () => {
  it('renames and sets colours, audited, slug untouched', async () => {
    await updateOrganizationProfile(owner, {
      name: '  FSS   Awards ',
      brandColors: { primary: '#1E3A8A', accent: '#F59E0B' },
    })
    const o = await org()
    expect(o).toMatchObject({ name: 'FSS Awards', slug: 'fss' })
    expect(parseBrandColors(o.brandColors as string)).toEqual({ primary: '#1e3a8a', accent: '#f59e0b' })
    const [row] = await audits()
    expect(row.action).toBe('organization.profile')
    expect(JSON.parse(row.metadata as string)).toEqual({
      fields: ['name', 'brandColors'],
      from: 'Faculty of Social Sciences',
      to: 'FSS Awards',
    })
  })

  it('clears colours with null', async () => {
    await updateOrganizationProfile(owner, { brandColors: { primary: '#000000' } })
    await updateOrganizationProfile(owner, { brandColors: null })
    expect((await org()).brandColors).toBeNull()
  })

  it('refuses bad input, no-ops and non-managers', async () => {
    await expect(updateOrganizationProfile(owner, { name: 'x' })).rejects.toMatchObject({ problem: 'nameInvalid' })
    await expect(updateOrganizationProfile(owner, { brandColors: { primary: 'red' } })).rejects.toMatchObject({
      problem: 'colorInvalid',
    })
    await expect(
      updateOrganizationProfile(owner, { brandColors: { primary: '#000000', accent: 'nope' } })
    ).rejects.toMatchObject({ problem: 'colorInvalid' })
    await expect(updateOrganizationProfile(owner, { name: 'Faculty of Social Sciences' })).rejects.toMatchObject({
      problem: 'noChange',
    })
    await expect(updateOrganizationProfile({ ...owner, role: 'staff' }, { name: 'New name' })).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(await audits()).toHaveLength(0)
  })
})

describe('setOrganizationLogo', () => {
  it('stores a PNG, links it, and replaces the old file', async () => {
    const a = await setOrganizationLogo(owner, solidPng(1200, 400, '#ff0000'))
    expect(a.logoUrl).toBe('https://fra.cloud.appwrite.io/v1/storage/buckets/org-logos/files/file1/view?project=proj')
    expect(logoFileId(a.logoUrl)).toBe('file1')
    const [bucket] = storage.createFile.mock.calls[0] as unknown as [string]
    expect(bucket).toBe('org-logos')
    await setOrganizationLogo(owner, solidPng(100, 100, '#00ff00'))
    expect(storage.deleteFile).toHaveBeenCalledWith('org-logos', 'file1')
    const removed = await setOrganizationLogo(owner, null)
    expect(removed.logoUrl).toBeNull()
    expect(storage.deleteFile).toHaveBeenCalledWith('org-logos', 'file2')
    expect(await audits()).toHaveLength(3)
  })

  it('rejects something that is not an image, and non-managers', async () => {
    await expect(setOrganizationLogo(owner, new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ problem: 'badImage' })
    await expect(setOrganizationLogo({ ...owner, role: 'designer' }, null)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('never deletes a file it did not write', () => {
    expect(logoFileId('https://example.com/logo.png')).toBeNull()
  })
})
