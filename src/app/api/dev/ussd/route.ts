import { isMockProviderActive } from '@/lib/payments'
import { handleUssd, type UssdInput } from '@/lib/ussd/handler'
import { NextResponse } from 'next/server'

/** Development only: drives the USSD handler directly for the simulator page. */
export async function POST(req: Request) {
  // Never against a real provider: a confirmed step sends a real MoMo prompt.
  if (process.env.NODE_ENV === 'production' || !isMockProviderActive())
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as Partial<UssdInput> | null
  if (!body?.sessionId || !body.phone || !body.type) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const output = await handleUssd({
    sessionId: String(body.sessionId),
    phone: String(body.phone),
    network: 'SIM',
    text: typeof body.text === 'string' ? body.text : '',
    type: body.type,
  })
  return NextResponse.json(output)
}
