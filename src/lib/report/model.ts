import type { CategoryDoc, EventDoc, NomineeDoc, RoundDoc, VoteDoc } from '../types'

/**
 * The cumulative round report (PRD 5.2b, CLAUDE.md rule 3b) as a plain
 * structure. Counts come from Vote rows: each vote belongs to exactly one
 * round, so summing per round and then across rounds cannot double count.
 * The cached RoundEntry tallies are not consulted.
 *
 * Superset of the formats OPEN_QUESTIONS #35 may choose between: per
 * category and per nominee, paid and free split, morale flag.
 */
export interface ReportRoundRef {
  id: string
  number: number
  name: string
  status: RoundDoc['status']
}

export interface ReportNomineeRow {
  nomineeId: string
  name: string
  code: string
  isMorale: boolean
  /** One entry per round in `rounds` order; null when the nominee had no entry in that round. */
  perRound: (number | null)[]
  paid: number
  free: number
  total: number
  rank: number
}

export interface ReportCategory {
  categoryId: string
  name: string
  nominees: ReportNomineeRow[]
}

export interface CumulativeReport {
  eventTitle: string
  rounds: ReportRoundRef[]
  categories: ReportCategory[]
  totals: { paid: number; free: number; total: number }
  /** True while any round is not closed: the numbers can still change. */
  provisional: boolean
}

export interface ReportInputs {
  event: Pick<EventDoc, 'title'>
  rounds: Pick<RoundDoc, '$id' | 'number' | 'name' | 'status'>[]
  categories: Pick<CategoryDoc, '$id' | 'name' | 'order'>[]
  nominees: Pick<NomineeDoc, '$id' | 'name' | 'code' | 'categoryId' | 'isMorale' | 'status'>[]
  votes: Pick<VoteDoc, 'nomineeId' | 'roundId' | 'quantity' | 'source'>[]
  /** Which nominees had an entry in which round: `${roundId}:${nomineeId}`. */
  entries: Set<string>
}

export function buildCumulativeReport(input: ReportInputs): CumulativeReport {
  const rounds = [...input.rounds].sort((a, b) => a.number - b.number)
  const roundIndex = new Map(rounds.map((r, i) => [r.$id, i]))

  // Sum per nominee per round, by source. One pass; a vote is counted exactly once.
  const perNominee = new Map<string, { perRound: number[]; paid: number; free: number }>()
  const bucket = (nomineeId: string) => {
    let b = perNominee.get(nomineeId)
    if (!b) {
      b = { perRound: rounds.map(() => 0), paid: 0, free: 0 }
      perNominee.set(nomineeId, b)
    }
    return b
  }
  for (const vote of input.votes) {
    const ri = roundIndex.get(vote.roundId)
    if (ri === undefined || !Number.isInteger(vote.quantity) || vote.quantity <= 0) continue
    const b = bucket(vote.nomineeId)
    b.perRound[ri] += vote.quantity
    if (vote.source === 'free') b.free += vote.quantity
    else b.paid += vote.quantity
  }

  const totals = { paid: 0, free: 0, total: 0 }
  const categories = [...input.categories]
    .sort((a, b) => a.order - b.order)
    .map((category) => {
      const rows: ReportNomineeRow[] = input.nominees
        .filter((n) => n.categoryId === category.$id)
        .map((n) => {
          const b = perNominee.get(n.$id)
          const perRound = rounds.map((r, i) =>
            input.entries.has(`${r.$id}:${n.$id}`) || (b?.perRound[i] ?? 0) > 0 ? (b?.perRound[i] ?? 0) : null
          )
          const paid = b?.paid ?? 0
          const free = b?.free ?? 0
          return {
            nomineeId: n.$id,
            name: n.name,
            code: n.code,
            isMorale: n.isMorale,
            perRound,
            paid,
            free,
            total: paid + free,
            rank: 0,
          }
        })
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      rows.forEach((row, i) => {
        row.rank = i > 0 && rows[i - 1].total === row.total ? rows[i - 1].rank : i + 1
        totals.paid += row.paid
        totals.free += row.free
      })
      return { categoryId: category.$id, name: category.name, nominees: rows }
    })
  totals.total = totals.paid + totals.free

  return {
    eventTitle: input.event.title,
    rounds: rounds.map((r) => ({ id: r.$id, number: r.number, name: r.name, status: r.status })),
    categories,
    totals,
    provisional: rounds.some((r) => r.status !== 'closed'),
  }
}
