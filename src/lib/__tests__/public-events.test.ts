import { describe, expect, it } from 'vitest'
import { groupPublicEvents, isPublicEvent } from '../public-events'
import type { EventStatus } from '../types'

const ev = (id: string, status: EventStatus, startsAt: string, endsAt: string) => ({ id, status, startsAt, endsAt })

describe('public events', () => {
  it('shows scheduled, live and paused events; never drafts or closed ones', () => {
    expect(
      ['draft', 'scheduled', 'live', 'paused', 'closed'].map((s) => isPublicEvent({ status: s as EventStatus }))
    ).toEqual([false, true, true, true, false])
  })

  it('groups and orders them for the home page', () => {
    const g = groupPublicEvents([
      ev('a', 'live', '2026-11-01T00:00:00Z', '2026-12-20T00:00:00Z'),
      ev('b', 'live', '2026-11-05T00:00:00Z', '2026-11-30T00:00:00Z'),
      ev('c', 'scheduled', '2027-01-10T00:00:00Z', '2027-02-01T00:00:00Z'),
      ev('d', 'scheduled', '2026-12-01T00:00:00Z', '2026-12-31T00:00:00Z'),
      ev('e', 'draft', '2026-12-01T00:00:00Z', '2026-12-31T00:00:00Z'),
      ev('f', 'closed', '2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z'),
      ev('g', 'paused', '2026-11-02T00:00:00Z', '2026-12-02T00:00:00Z'),
    ])
    expect(g.live.map((e) => e.id)).toEqual(['b', 'a'])
    expect(g.upcoming.map((e) => e.id)).toEqual(['d', 'c'])
    expect(g.paused.map((e) => e.id)).toEqual(['g'])
  })
})
