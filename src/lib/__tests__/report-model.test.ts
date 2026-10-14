import { describe, expect, test } from 'vitest'
import { buildCumulativeReport, type ReportInputs } from '../report/model'

const rounds = [
  { $id: 'r1', number: 1, name: 'Round 1', status: 'closed' as const },
  { $id: 'r2', number: 2, name: 'Final', status: 'live' as const },
]
const categories = [
  { $id: 'c1', name: 'Miss Social Science', order: 1 },
  { $id: 'c2', name: 'Most Influential', order: 2 },
]
const nominees = [
  { $id: 'ama', name: 'Ama', code: '1001', categoryId: 'c1', isMorale: false, status: 'active' as const },
  { $id: 'efua', name: 'Efua', code: '1002', categoryId: 'c1', isMorale: false, status: 'active' as const },
  { $id: 'yaa', name: 'Yaa', code: '1003', categoryId: 'c1', isMorale: true, status: 'active' as const },
  { $id: 'kofi', name: 'Kofi', code: '2001', categoryId: 'c2', isMorale: false, status: 'active' as const },
]
const entries = new Set(['r1:ama', 'r1:efua', 'r1:yaa', 'r1:kofi', 'r2:ama', 'r2:efua', 'r2:kofi'])

function build(votes: ReportInputs['votes'], extra: Partial<ReportInputs> = {}) {
  return buildCumulativeReport({ event: { title: 'Awards' }, rounds, categories, nominees, votes, entries, ...extra })
}

describe('buildCumulativeReport', () => {
  test('sums each vote once, per round and across rounds, split by source', () => {
    const report = build([
      { nomineeId: 'ama', roundId: 'r1', quantity: 10, source: 'paid' },
      { nomineeId: 'ama', roundId: 'r1', quantity: 5, source: 'paid' },
      { nomineeId: 'ama', roundId: 'r2', quantity: 7, source: 'paid' },
      { nomineeId: 'efua', roundId: 'r1', quantity: 20, source: 'paid' },
      { nomineeId: 'efua', roundId: 'r2', quantity: 1, source: 'free' },
      { nomineeId: 'kofi', roundId: 'r2', quantity: 3, source: 'paid' },
    ])
    const c1 = report.categories[0]
    expect(c1.nominees.map((n) => [n.name, n.perRound, n.paid, n.free, n.total, n.rank])).toEqual([
      ['Ama', [15, 7], 22, 0, 22, 1],
      ['Efua', [20, 1], 20, 1, 21, 2],
      ['Yaa', [0, null], 0, 0, 0, 3],
    ])
    expect(report.categories[1].nominees[0]).toMatchObject({ name: 'Kofi', perRound: [0, 3], total: 3 })
    expect(report.totals).toEqual({ paid: 45, free: 1, total: 46 })
    expect(report.provisional).toBe(true)
    expect(report.rounds.map((r) => r.name)).toEqual(['Round 1', 'Final'])
  })

  test('a nominee without an entry in a round shows null, not zero; ties share a rank', () => {
    const report = build([
      { nomineeId: 'ama', roundId: 'r1', quantity: 5, source: 'paid' },
      { nomineeId: 'efua', roundId: 'r1', quantity: 5, source: 'paid' },
    ])
    const [first, second, third] = report.categories[0].nominees
    expect([first.rank, second.rank, third.rank]).toEqual([1, 1, 3])
    expect(third.name).toBe('Yaa')
    expect(third.perRound).toEqual([0, null])
  })

  test('ignores votes for unknown rounds and non-positive quantities, and flags morale candidates', () => {
    const report = build([
      { nomineeId: 'yaa', roundId: 'r9', quantity: 100, source: 'paid' },
      { nomineeId: 'yaa', roundId: 'r1', quantity: 0, source: 'paid' },
      { nomineeId: 'yaa', roundId: 'r1', quantity: 2, source: 'free' },
    ])
    const yaa = report.categories[0].nominees.find((n) => n.name === 'Yaa')!
    expect(yaa).toMatchObject({ isMorale: true, paid: 0, free: 2, total: 2, rank: 1 })
    expect(report.totals).toEqual({ paid: 0, free: 2, total: 2 })
  })

  test('is final once every round is closed, and orders rounds by number', () => {
    const report = build([], { rounds: [rounds[1], { ...rounds[0] }].map((r) => ({ ...r, status: 'closed' })) })
    expect(report.provisional).toBe(false)
    expect(report.rounds.map((r) => r.number)).toEqual([1, 2])
  })
})
