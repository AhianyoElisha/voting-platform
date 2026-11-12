import type { EventDoc, EventStatus } from './types'

/** Statuses the public may see. Drafts and closed events stay private for now. */
export const PUBLIC_EVENT_STATUSES: ReadonlySet<EventStatus> = new Set<EventStatus>(['scheduled', 'live', 'paused'])

export function isPublicEvent(event: Pick<EventDoc, 'status'>): boolean {
  return PUBLIC_EVENT_STATUSES.has(event.status)
}

export interface PublicEventGroups<E> {
  /** Voting is open: soonest to end first. */
  live: E[]
  /** Not open yet: soonest to start first. */
  upcoming: E[]
  /** Paused by the organizer. */
  paused: E[]
}

/** An organization's public events, grouped for its home page. */
export function groupPublicEvents<E extends Pick<EventDoc, 'status' | 'startsAt' | 'endsAt'>>(
  events: E[]
): PublicEventGroups<E> {
  const by = (key: 'startsAt' | 'endsAt') => (a: E, b: E) => Date.parse(a[key]) - Date.parse(b[key])
  return {
    live: events.filter((e) => e.status === 'live').sort(by('endsAt')),
    upcoming: events.filter((e) => e.status === 'scheduled').sort(by('startsAt')),
    paused: events.filter((e) => e.status === 'paused').sort(by('startsAt')),
  }
}
