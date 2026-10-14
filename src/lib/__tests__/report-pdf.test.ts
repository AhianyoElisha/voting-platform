import { describe, expect, test } from 'vitest'
import { solidPng } from '../flyer/render'
import { buildCumulativeReport } from '../report/model'
import { renderCumulativeReportPdf } from '../report/pdf'

function sampleReport(roundCount: number) {
  const rounds = Array.from({ length: roundCount }, (_, i) => ({
    $id: `r${i + 1}`,
    number: i + 1,
    name: `Round ${i + 1}`,
    status: i === roundCount - 1 ? ('live' as const) : ('closed' as const),
  }))
  const nominees = Array.from({ length: 12 }, (_, i) => ({
    $id: `n${i}`,
    name: `Nominee ${i} With A Fairly Long Name`,
    code: String(1000 + i),
    categoryId: i < 6 ? 'c1' : 'c2',
    isMorale: i === 3,
    status: 'active' as const,
  }))
  const votes = nominees.flatMap((n, i) =>
    rounds.map((r, j) => ({
      nomineeId: n.$id,
      roundId: r.$id,
      quantity: (i + 1) * (j + 1),
      source: i % 4 === 0 ? ('free' as const) : ('paid' as const),
    }))
  )
  const entries = new Set(nominees.flatMap((n) => rounds.map((r) => `${r.$id}:${n.$id}`)))
  return buildCumulativeReport({
    event: { title: 'Faculty Awards 2026' },
    rounds,
    categories: [
      { $id: 'c1', name: 'Miss Social Science', order: 1 },
      { $id: 'c2', name: 'Most Influential', order: 2 },
      { $id: 'c3', name: 'Empty Category', order: 3 },
    ],
    nominees,
    votes,
    entries,
  })
}

describe('renderCumulativeReportPdf', () => {
  test('produces a PDF for a two-round event with a logo', async () => {
    const pdf = await renderCumulativeReportPdf(sampleReport(2), {
      organizationName: 'Faculty of Social Sciences',
      logo: solidPng(64, 64, '#2563eb'),
      generatedAt: new Date('2026-11-30T18:00:00Z'),
    })
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(2000)
    expect(new TextDecoder('latin1').decode(pdf.slice(-6)).trim().endsWith('%%EOF')).toBe(true)
  })

  test('handles six rounds in landscape, an empty category and no logo', async () => {
    const pdf = await renderCumulativeReportPdf(sampleReport(6), { organizationName: 'Org', logo: null })
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(2000)
  })

  test('an unreadable logo is skipped rather than failing the report', async () => {
    const pdf = await renderCumulativeReportPdf(sampleReport(1), {
      organizationName: 'Org',
      logo: new Uint8Array([1, 2, 3]),
    })
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
  })
})
