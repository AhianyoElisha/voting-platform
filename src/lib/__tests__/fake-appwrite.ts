import { vi } from 'vitest'

/**
 * In-memory stand-in for `node-appwrite`'s Databases, enough for the domain
 * modules: create/get/list/update/delete with the JSON query strings the SDK
 * emits (`equal`, `lessThan`, `startsWith`, `limit`, `orderAsc`, `orderDesc`,
 * `cursorAfter`), unique
 * indexes that reject duplicates with a 409, atomic increments, and
 * transactions: writes carrying a `transactionId` are staged and applied at
 * commit, all or nothing, with duplicate ids and unique indexes checked
 * against the committed state at commit time, as Appwrite does.
 *
 * Tests use it through `vi.mock('../appwrite-server', ...)`. Because `db.ts`
 * then runs for real, tenant scoping is exercised end to end.
 */
type Row = Record<string, unknown> & { $id: string; $createdAt: string; $updatedAt: string }

interface ParsedQuery {
  method: string
  attribute?: string
  values?: unknown[]
}

type Op =
  | { kind: 'create'; table: string; id: string; data: Record<string, unknown> }
  | { kind: 'update'; table: string; id: string; data: Record<string, unknown> }
  | { kind: 'increment'; table: string; id: string; attribute: string; value: number }

export class AppwriteError extends Error {
  constructor(
    message: string,
    public code: number
  ) {
    super(message)
  }
}

export function createFakeDatabases(uniqueIndexes: Record<string, string[][]> = {}) {
  const tables = new Map<string, Map<string, Row>>()
  const transactions = new Map<string, { ops: Op[]; status: string }>()
  let seq = 0

  const rows = (table: string, store = tables) => {
    if (!store.has(table)) store.set(table, new Map())
    return store.get(table)!
  }

  const checkUnique = (
    store: Map<string, Map<string, Row>>,
    table: string,
    candidate: Record<string, unknown>,
    exceptId?: string
  ) => {
    for (const columns of uniqueIndexes[table] ?? []) {
      if (columns.some((c) => candidate[c] === null || candidate[c] === undefined)) continue
      for (const row of rows(table, store).values()) {
        if (row.$id === exceptId) continue
        if (columns.every((c) => row[c] === candidate[c])) {
          throw new AppwriteError(`Duplicate on ${columns.join('+')}`, 409)
        }
      }
    }
  }

  const nextTimestamp = () => new Date(Date.UTC(2026, 9, 14, 0, 0, 0, ++seq)).toISOString()

  const apply = (store: Map<string, Map<string, Row>>, op: Op): Row => {
    const table = rows(op.table, store)
    if (op.kind === 'create') {
      if (table.has(op.id)) throw new AppwriteError('Document with the requested ID already exists', 409)
      checkUnique(store, op.table, op.data)
      const now = nextTimestamp()
      const row: Row = { ...op.data, $id: op.id, $createdAt: now, $updatedAt: now, $sequence: seq }
      table.set(op.id, row)
      return { ...row }
    }
    const row = table.get(op.id)
    if (!row) throw new AppwriteError('Document not found', 404)
    if (op.kind === 'update') {
      const next = { ...row, ...op.data, $updatedAt: nextTimestamp() }
      checkUnique(store, op.table, next, op.id)
      table.set(op.id, next)
      return { ...next }
    }
    const current = row[op.attribute]
    if (typeof current !== 'number') throw new AppwriteError(`Attribute ${op.attribute} is not numeric`, 400)
    const next = { ...row, [op.attribute]: current + op.value, $updatedAt: nextTimestamp() }
    table.set(op.id, next)
    return { ...next }
  }

  const stageOrApply = (op: Op, transactionId?: string): Row => {
    if (!transactionId) return apply(tables, op)
    const tx = transactions.get(transactionId)
    if (!tx || tx.status !== 'pending') throw new AppwriteError('Transaction not found or not pending', 404)
    tx.ops.push(op)
    // Appwrite returns the row as it would look; good enough for callers.
    const existing = rows(op.table).get(op.id)
    return { ...(existing ?? {}), ...(op.kind === 'increment' ? {} : op.data), $id: op.id } as Row
  }

  const parse = (queries: string[]): ParsedQuery[] => queries.map((q) => JSON.parse(q))

  const databases = {
    createDocument: vi.fn(
      async (
        _db: string,
        table: string,
        id: string,
        data: Record<string, unknown>,
        _permissions?: string[],
        transactionId?: string
      ) => {
        const $id = id === 'unique()' || !id ? `id_${++seq}` : id
        return stageOrApply({ kind: 'create', table, id: $id, data }, transactionId)
      }
    ),
    getDocument: vi.fn(async (_db: string, table: string, id: string) => {
      const row = rows(table).get(id)
      if (!row) throw new AppwriteError('Document not found', 404)
      return { ...row }
    }),
    listDocuments: vi.fn(async (_db: string, table: string, queries: string[] = []) => {
      let list = [...rows(table).values()]
      let limit = 25
      for (const q of parse(queries)) {
        if (q.method === 'equal') {
          const values = q.values ?? []
          list = list.filter((r) => values.includes(r[q.attribute!]))
        } else if (q.method === 'isNull') {
          list = list.filter((r) => r[q.attribute!] === null || r[q.attribute!] === undefined)
        } else if (q.method === 'greaterThan') {
          const v = q.values?.[0] as string | number
          list = list.filter((r) => (r[q.attribute!] as string | number) > v)
        } else if (q.method === 'lessThan') {
          const v = q.values?.[0] as string | number
          list = list.filter((r) => (r[q.attribute!] as string | number) < v)
        } else if (q.method === 'startsWith') {
          const v = String(q.values?.[0] ?? '')
          list = list.filter((r) => String(r[q.attribute!] ?? '').startsWith(v))
        } else if (q.method === 'cursorAfter') {
          const at = list.findIndex((r) => r.$id === q.values?.[0])
          list = at === -1 ? [] : list.slice(at + 1)
        } else if (q.method === 'limit') {
          limit = Number(q.values?.[0] ?? 25)
        } else if (q.method === 'orderAsc' || q.method === 'orderDesc') {
          const dir = q.method === 'orderAsc' ? 1 : -1
          const key = q.attribute!
          list.sort((a, b) => (a[key]! > b[key]! ? dir : a[key]! < b[key]! ? -dir : 0))
        }
      }
      const total = list.length
      list = list.slice(0, limit)
      return { total, documents: list.map((r) => ({ ...r })) }
    }),
    updateDocument: vi.fn(
      async (
        _db: string,
        table: string,
        id: string,
        data: Record<string, unknown>,
        _permissions?: string[],
        transactionId?: string
      ) => stageOrApply({ kind: 'update', table, id, data }, transactionId)
    ),
    incrementDocumentAttribute: vi.fn(
      async (
        _db: string,
        table: string,
        id: string,
        attribute: string,
        value = 1,
        _max?: number,
        transactionId?: string
      ) => stageOrApply({ kind: 'increment', table, id, attribute, value }, transactionId)
    ),
    deleteDocument: vi.fn(async (_db: string, table: string, id: string) => {
      if (!rows(table).delete(id)) throw new AppwriteError('Document not found', 404)
    }),
    createTransaction: vi.fn(async () => {
      const $id = `tx_${++seq}`
      transactions.set($id, { ops: [], status: 'pending' })
      return { $id, status: 'pending', operations: 0 }
    }),
    updateTransaction: vi.fn(async (id: string, commit?: boolean, rollback?: boolean) => {
      const tx = transactions.get(id)
      if (!tx) throw new AppwriteError('Transaction not found', 404)
      if (rollback) {
        tx.status = 'rolled_back'
        return { $id: id, status: tx.status, operations: tx.ops.length }
      }
      if (commit) {
        // All or nothing: apply to a copy, swap in only if every op succeeds.
        const copy = new Map<string, Map<string, Row>>()
        for (const [name, table] of tables) copy.set(name, new Map(table))
        try {
          for (const op of tx.ops) apply(copy, op)
        } catch (err) {
          tx.status = 'failed'
          throw err
        }
        for (const [name, table] of copy) tables.set(name, table)
        tx.status = 'committed'
      }
      return { $id: id, status: tx.status, operations: tx.ops.length }
    }),
    /** Test helper: raw rows of a table. */
    dump: (table: string) => [...rows(table).values()],
    /** Test helper: seed a row directly. */
    seed: (table: string, row: Record<string, unknown> & { $id: string }) => {
      rows(table).set(row.$id, { $createdAt: nextTimestamp(), $updatedAt: '', ...row } as Row)
    },
    /** Test helper: transaction statuses. */
    transactionStatuses: () => [...transactions.values()].map((t) => t.status),
  }
  return databases
}

export type FakeDatabases = ReturnType<typeof createFakeDatabases>

/** The unique indexes from appwrite.config.json that matter to these tests. */
export const UNIQUE_INDEXES: Record<string, string[][]> = {
  organizations: [['slug']],
  memberships: [['userId', 'organizationId']],
  events: [['organizationId', 'slug']],
  rounds: [['eventId', 'number']],
  nominees: [['code']],
  round_entries: [['roundId', 'nomineeId']],
  payments: [['providerReference']],
  ledger_entries: [['paymentId']],
}
