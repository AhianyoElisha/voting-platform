import type { ResultsVisibility } from './types'

/**
 * Shapes a round tally for the public page according to the organizer's
 * `resultsVisibility` (PRD 5.4). Pure, so the rule is testable: `hidden`
 * shows nothing, `ranking` shows order only, `percentage` shows shares,
 * `count` shows the numbers. Percentages are integers that sum to 100 by
 * largest remainder, so the page never shows 99% or 101% in total.
 *
 * Free votes are never merged into paid ones (decision #29): when a nominee
 * has any, the shaped row carries the count separately for the page to show,
 * in every visible mode including `ranking` (decided 2026-11-12).
 */
export interface TallyInput {
  nomineeId: string
  name: string
  categoryId: string
  /** Total votes, paid plus free. */
  votes: number
  /** Free votes within `votes` (decision #29: always shown separately). */
  free?: number
}

export interface PublicResultRow {
  nomineeId: string
  name: string
  categoryId: string
  rank: number
  /** Present for `count`. */
  votes?: number
  /** Present for `percentage`. */
  percent?: number
  /** Free votes within the total, present whenever any were granted, in every visible mode. */
  free?: number
}

export function shapeResults(rows: TallyInput[], visibility: ResultsVisibility): PublicResultRow[] | null {
  if (visibility === 'hidden') return null
  const byCategory = new Map<string, TallyInput[]>()
  for (const row of rows) {
    if (!byCategory.has(row.categoryId)) byCategory.set(row.categoryId, [])
    byCategory.get(row.categoryId)!.push(row)
  }
  const out: PublicResultRow[] = []
  for (const group of byCategory.values()) {
    const sorted = [...group].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name))
    const percents = visibility === 'percentage' ? largestRemainderPercents(sorted.map((r) => r.votes)) : null
    sorted.forEach((row, i) => {
      // Ties share a rank.
      const rank = i > 0 && sorted[i - 1].votes === row.votes ? out[out.length - 1].rank : i + 1
      const shaped: PublicResultRow = { nomineeId: row.nomineeId, name: row.name, categoryId: row.categoryId, rank }
      if (visibility === 'count') shaped.votes = row.votes
      if ((row.free ?? 0) > 0) shaped.free = row.free
      if (percents) shaped.percent = percents[i]
      out.push(shaped)
    })
  }
  return out
}

export function largestRemainderPercents(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0)
  if (total === 0) return values.map(() => 0)
  const exact = values.map((v) => (v * 100) / total)
  const floors = exact.map(Math.floor)
  let remaining = 100 - floors.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => ({ i, frac: e - floors[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (remaining <= 0) break
    floors[i] += 1
    remaining -= 1
  }
  return floors
}
