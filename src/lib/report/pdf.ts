import PDFDocument from 'pdfkit'
import type { CumulativeReport } from './model'

/**
 * Renders the cumulative report with pdfkit (ARCHITECTURE.md "Added for this
 * product"). Built-in Helvetica, no custom fonts: this is a results document,
 * not a flyer. Landscape when there are many rounds so the columns fit.
 */
export interface ReportBranding {
  organizationName: string
  /** PNG or JPEG bytes; optional. */
  logo?: Uint8Array | null
  generatedAt?: Date
  timeZone?: string
}

export async function renderCumulativeReportPdf(
  report: CumulativeReport,
  branding: ReportBranding
): Promise<Uint8Array> {
  const landscape = report.rounds.length > 4
  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    margin: 40,
    info: { Title: `${report.eventTitle} – cumulative report` },
  })
  const chunks: Uint8Array[] = []
  doc.on('data', (c: Buffer) => chunks.push(new Uint8Array(c)))
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('end', () => {
      const total = chunks.reduce((n, c) => n + c.length, 0)
      const out = new Uint8Array(total)
      let offset = 0
      for (const c of chunks) {
        out.set(c, offset)
        offset += c.length
      }
      resolve(out)
    })
    doc.on('error', reject)
  })

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const generatedAt = branding.generatedAt ?? new Date()
  const when = generatedAt.toLocaleString('en-GB', {
    timeZone: branding.timeZone ?? 'Africa/Accra',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  // Header
  let y = doc.y
  if (branding.logo && branding.logo.length > 0) {
    try {
      doc.image(Buffer.from(branding.logo), doc.page.margins.left, y, { fit: [48, 48] })
      doc.x = doc.page.margins.left + 58
    } catch {
      /* unreadable logo: skip it */
    }
  }
  doc.font('Helvetica-Bold').fontSize(16).text(branding.organizationName, { continued: false })
  doc.font('Helvetica').fontSize(12).text(report.eventTitle)
  doc
    .fontSize(9)
    .fillColor('#555555')
    .text(
      `Cumulative results across ${report.rounds.length} round${report.rounds.length === 1 ? '' : 's'} · generated ${when}`
    )
  if (report.provisional) {
    const open = report.rounds.filter((r) => r.status !== 'closed').map((r) => r.name)
    doc
      .fillColor('#b45309')
      .text(
        `Provisional: ${open.join(', ')} ${open.length === 1 ? 'is' : 'are'} not closed yet, so these numbers can still change.`
      )
  }
  doc.fillColor('#000000').moveDown(0.8)

  // Table layout: rank, nominee, code, one column per round, paid, free, total.
  const roundCols = report.rounds.length
  const fixed = { rank: 28, name: landscape ? 170 : 130, code: 44, paid: 46, free: 40, total: 50 }
  const fixedWidth = Object.values(fixed).reduce((a, b) => a + b, 0)
  const roundWidth = Math.max(36, Math.floor((pageWidth - fixedWidth) / Math.max(1, roundCols)))
  const rowHeight = 16

  const drawHeader = () => {
    let x = doc.page.margins.left
    const yy = doc.y
    doc.font('Helvetica-Bold').fontSize(8)
    const cell = (text: string, w: number, align: 'left' | 'right' = 'left') => {
      doc.text(text, x, yy, { width: w - 4, align, lineBreak: false })
      x += w
    }
    cell('#', fixed.rank)
    cell('Nominee', fixed.name)
    cell('Code', fixed.code)
    for (const r of report.rounds) cell(r.name.length > 10 ? `R${r.number}` : r.name, roundWidth, 'right')
    cell('Paid', fixed.paid, 'right')
    cell('Free', fixed.free, 'right')
    cell('Total', fixed.total, 'right')
    doc.y = yy + rowHeight
    doc
      .moveTo(doc.page.margins.left, doc.y - 3)
      .lineTo(doc.page.margins.left + pageWidth, doc.y - 3)
      .lineWidth(0.5)
      .strokeColor('#999999')
      .stroke()
    doc.font('Helvetica').fontSize(8).fillColor('#000000')
  }

  const ensureRoom = (needed: number) => {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
      doc.addPage()
    }
  }

  for (const category of report.categories) {
    ensureRoom(rowHeight * 4)
    doc.font('Helvetica-Bold').fontSize(11).text(category.name)
    doc.moveDown(0.2)
    drawHeader()
    if (category.nominees.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#777777').text('No nominees', doc.page.margins.left, doc.y)
      doc.fillColor('#000000').moveDown(1)
      continue
    }
    for (const row of category.nominees) {
      ensureRoom(rowHeight)
      if (doc.y === doc.page.margins.top) drawHeader()
      let x = doc.page.margins.left
      const yy = doc.y
      const cell = (text: string, w: number, align: 'left' | 'right' = 'left') => {
        doc.text(text, x, yy, { width: w - 4, align, lineBreak: false, ellipsis: true })
        x += w
      }
      cell(String(row.rank), fixed.rank)
      cell(row.isMorale ? `${row.name} (morale)` : row.name, fixed.name)
      cell(row.code, fixed.code)
      for (const v of row.perRound) cell(v === null ? '—' : String(v), roundWidth, 'right')
      cell(String(row.paid), fixed.paid, 'right')
      cell(String(row.free), fixed.free, 'right')
      doc.font('Helvetica-Bold')
      cell(String(row.total), fixed.total, 'right')
      doc.font('Helvetica')
      doc.y = yy + rowHeight
    }
    doc.moveDown(0.8)
  }

  ensureRoom(rowHeight * 3)
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(
      `Event total: ${report.totals.total} votes (${report.totals.paid} paid, ${report.totals.free} free)`,
      doc.page.margins.left,
      doc.y
    )
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#555555')
    .text('Each vote is counted once, in the round it was cast. Dash: the nominee was not in that round.')

  doc.end()
  return done
}
