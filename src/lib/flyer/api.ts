import { NextResponse } from 'next/server'
import { FontError, TemplateError } from './templates-server'

/** Maps flyer-engine errors to responses; everything else falls through to the shared handler. */
export function flyerErrorResponse(err: unknown, t: (key: string) => string): NextResponse | null {
  if (err instanceof TemplateError) {
    const status = err.problem === 'wrongEvent' ? 404 : 400
    return NextResponse.json(
      { error: t(`errors:template.${err.problem}`), code: err.problem, details: err.details },
      { status }
    )
  }
  if (err instanceof FontError) {
    return NextResponse.json({ error: t(`errors:font.${err.problem}`), code: err.problem }, { status: 400 })
  }
  return null
}

export function templateView(
  t: {
    $id: string
    name: string
    width: number
    height: number
    backgroundFileId: string | null
    canvasJson: string
    status: string
    version: number
    categoryId: string | null
  },
  backgroundUrl: string | null
) {
  return {
    id: t.$id,
    name: t.name,
    width: t.width,
    height: t.height,
    backgroundUrl,
    model: JSON.parse(t.canvasJson),
    status: t.status,
    version: t.version,
    categoryId: t.categoryId,
  }
}
