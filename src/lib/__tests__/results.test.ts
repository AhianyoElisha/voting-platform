import { describe, expect, test } from 'vitest'
import { largestRemainderPercents, shapeResults } from '../results'

const rows = [
  { nomineeId: 'a', name: 'Ama', categoryId: 'c1', votes: 50 },
  { nomineeId: 'b', name: 'Kofi', categoryId: 'c1', votes: 30 },
  { nomineeId: 'c', name: 'Yaw', categoryId: 'c1', votes: 30 },
  { nomineeId: 'd', name: 'Esi', categoryId: 'c2', votes: 0 },
]

describe('shapeResults', () => {
  test('hidden shows nothing', () => {
    expect(shapeResults(rows, 'hidden')).toBeNull()
  })

  test('ranking shows order only, ties share a rank', () => {
    const out = shapeResults(rows, 'ranking')!
    expect(out.map((r) => [r.name, r.rank])).toEqual([
      ['Ama', 1],
      ['Kofi', 2],
      ['Yaw', 2],
      ['Esi', 1],
    ])
    expect(out.every((r) => r.votes === undefined && r.percent === undefined)).toBe(true)
  })

  test('percentage shows integer shares that sum to 100 per category', () => {
    const out = shapeResults(rows, 'percentage')!
    const c1 = out.filter((r) => r.categoryId === 'c1').map((r) => r.percent)
    expect(c1).toEqual([46, 27, 27])
    expect(c1.reduce((a, b) => a! + b!, 0)).toBe(100)
    expect(out.find((r) => r.name === 'Esi')?.percent).toBe(0)
    expect(out.every((r) => r.votes === undefined)).toBe(true)
  })

  test('count shows the numbers', () => {
    const out = shapeResults(rows, 'count')!
    expect(out.find((r) => r.name === 'Ama')).toMatchObject({ votes: 50, rank: 1 })
  })

  test('free votes are carried separately in every visible mode, ranking included (decision #29)', () => {
    const withFree = rows.map((r) => (r.name === 'Kofi' ? { ...r, free: 12 } : r))
    expect(shapeResults(withFree, 'count')!.find((r) => r.name === 'Kofi')).toMatchObject({ votes: 30, free: 12 })
    expect(shapeResults(withFree, 'percentage')!.find((r) => r.name === 'Kofi')).toMatchObject({
      percent: 27,
      free: 12,
    })
    expect(shapeResults(withFree, 'ranking')!.find((r) => r.name === 'Kofi')).toMatchObject({ free: 12 })
    expect(shapeResults(withFree, 'ranking')!.find((r) => r.name === 'Kofi')!.votes).toBeUndefined()
    expect(shapeResults(withFree, 'count')!.find((r) => r.name === 'Ama')!.free).toBeUndefined()
  })
})

describe('largestRemainderPercents', () => {
  test('always sums to 100 for non-empty totals', () => {
    for (const values of [
      [1, 1, 1],
      [2, 3, 5, 7],
      [33, 33, 34],
      [1, 2],
      [999, 1],
    ]) {
      const p = largestRemainderPercents(values)
      expect(p.reduce((a, b) => a + b, 0)).toBe(100)
      expect(p.every(Number.isInteger)).toBe(true)
    }
    expect(largestRemainderPercents([0, 0])).toEqual([0, 0])
  })
})
