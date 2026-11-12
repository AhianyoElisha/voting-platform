import type { UssdInput, UssdOutput } from './handler'

/**
 * Hubtel USSD transport (decision #11). Hubtel POSTs one JSON object per
 * step and expects one back. Field names follow Hubtel's programmable
 * services API; like the payment shapes, confirm against the sandbox
 * (docs/SMOKE_TEST.md, USSD section). Only this file knows the shape.
 *
 * Request:  { Type, Mobile, SessionId, ServiceCode, Message, Operator, Sequence, ClientState }
 *           Type is "Initiation" | "Response" | "Timeout" | "Release".
 * Response: { SessionId, Type: "Response" | "Release", Message, Label, ClientState, DataType, FieldType }
 */
export interface HubtelUssdRequest {
  Type: string
  Mobile: string
  SessionId: string
  ServiceCode?: string
  Message?: string
  Operator?: string
  Sequence?: number
  ClientState?: string
}

export interface HubtelUssdResponse {
  SessionId: string
  Type: 'Response' | 'Release'
  Message: string
  Label: string
  ClientState: string
  DataType: 'input' | 'display'
  FieldType: 'text'
}

function pick(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) if (k.toLowerCase() === lower) return v
  return undefined
}

export function parseHubtelUssdRequest(body: unknown): UssdInput | null {
  const type = String(pick(body, 'Type') ?? '').toLowerCase()
  const sessionId = String(pick(body, 'SessionId') ?? '').trim()
  const mobile = String(pick(body, 'Mobile') ?? '').trim()
  if (!sessionId || !mobile) return null
  const kind: UssdInput['type'] | null =
    type === 'initiation'
      ? 'initiation'
      : type === 'response'
        ? 'response'
        : type === 'timeout'
          ? 'timeout'
          : type === 'release'
            ? 'release'
            : null
  if (!kind) return null
  const message = pick(body, 'Message')
  return {
    sessionId,
    phone: mobile,
    network: typeof pick(body, 'Operator') === 'string' ? (pick(body, 'Operator') as string) : null,
    // On Initiation the Message is the dialled code, not a menu choice.
    text: kind === 'initiation' ? '' : typeof message === 'string' ? message : '',
    type: kind,
  }
}

export function buildHubtelUssdResponse(sessionId: string, output: UssdOutput, label = 'voteapp'): HubtelUssdResponse {
  return {
    SessionId: sessionId,
    Type: output.end ? 'Release' : 'Response',
    Message: output.message,
    Label: label,
    ClientState: '',
    DataType: output.end ? 'display' : 'input',
    FieldType: 'text',
  }
}
