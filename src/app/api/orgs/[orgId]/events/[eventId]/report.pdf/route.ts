import { domainErrorResponse, withTenant } from '@/lib/api-tenant'
import { loadCumulativeReport } from '@/lib/report/data'
import { renderCumulativeReportPdf } from '@/lib/report/pdf'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ orgId: string; eventId: string }> }

/** GET: the cumulative round report as a PDF attachment. Any membership role. */
export async function GET(_req: Request, { params }: Params) {
  const { orgId, eventId } = await params
  const r = await withTenant(orgId)
  if ('response' in r) return r.response
  try {
    const { report, event, organization } = await loadCumulativeReport(r.ctx, eventId)
    let logo: Uint8Array | null = null
    if (organization?.logoUrl) {
      try {
        const res = await fetch(organization.logoUrl)
        if (res.ok) logo = new Uint8Array(await res.arrayBuffer())
      } catch {
        logo = null
      }
    }
    const pdf = await renderCumulativeReportPdf(report, { organizationName: organization?.name ?? '', logo })
    return new NextResponse(pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${event.slug}-cumulative-report.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return domainErrorResponse(err, r.t, 'report.pdf')
  }
}
