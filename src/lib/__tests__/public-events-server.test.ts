import { beforeEach, describe, expect, test, vi } from 'vitest'
import { UNIQUE_INDEXES, createFakeDatabases, type FakeDatabases } from './fake-appwrite'

let fake: FakeDatabases
vi.mock('../appwrite-server', () => ({
  createAdminClient: () => ({ databases: fake }),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}))

import { listDirectoryEvents } from '../public-events-server'

const org = (id: string, status = 'active') =>
  fake.seed('organizations', { $id: id, name: `Org ${id}`, slug: `org-${id}`, status })

const event = (id: string, organizationId: string, status: string) =>
  fake.seed('events', {
    $id: id,
    organizationId,
    title: `Event ${id}`,
    slug: `event-${id}`,
    status,
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-12-01T00:00:00.000Z',
    votePrice: 100,
  })

beforeEach(() => {
  process.env.APPWRITE_DATABASE_ID = 'voteapp'
  fake = createFakeDatabases(UNIQUE_INDEXES)
})

describe('platform event directory', () => {
  test('lists public events of active organizations, each with its own organization', async () => {
    org('a')
    org('b')
    event('e1', 'a', 'live')
    event('e2', 'b', 'scheduled')
    event('e3', 'b', 'paused')
    const entries = await listDirectoryEvents()
    expect(entries.map((e) => [e.event.$id, e.organization.$id]).sort()).toEqual([
      ['e1', 'a'],
      ['e2', 'b'],
      ['e3', 'b'],
    ])
  })

  test('never lists drafts or closed events', async () => {
    org('a')
    event('e1', 'a', 'draft')
    event('e2', 'a', 'closed')
    expect(await listDirectoryEvents()).toEqual([])
  })

  test('hides every event of a suspended organization', async () => {
    org('a')
    org('s', 'suspended')
    event('e1', 'a', 'live')
    event('e2', 's', 'live')
    expect((await listDirectoryEvents()).map((e) => e.event.$id)).toEqual(['e1'])
  })
})
