import { vi } from 'vitest'

/**
 * In-memory stand-in for `node-appwrite`'s Databases, enough for the domain
 * modules: create/get/list/update/delete with the JSON query strings the SDK
 * emits (`equal`, `limit`, `orderAsc`, `orderDesc`) and unique indexes that
 * reject duplicates with a 409, as Appwrite does.
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
  let seq = 0

  const rows = (table: string) => {
    if (!tables.has(table)) tables.set(table, new Map())
    return tables.get(table)!
  }

  const checkUnique = (table: string, candidate: Record<string, unknown>, exceptId?: string) => {
    for (const columns of uniqueIndexes[table] ?? []) {
      for (const row of rows(table).values()) {
        if (row.$id === exceptId) continue
        if (columns.every((c) => row[c] === candidate[c])) {
          throw new AppwriteError(`Duplicate on ${columns.join('+')}`, 409)
        }
      }
    }
  }

  const parse = (queries: string[]): ParsedQuery[] => queries.map((q) => JSON.parse(q))

  const databases = {
    createDocument: vi.fn(async (_db: string, table: string, id: string, data: Record<string, unknown>) => {
      const $id = id === 'unique()' || !id ? `id_${++seq}` : id
      if (rows(table).has($id)) throw new AppwriteError('Document already exists', 409)
      checkUnique(table, data)
      const now = new Date(Date.UTC(2026, 9, 14, 0, 0, ++seq)).toISOString()
      const row: Row = { ...data, $id, $createdAt: now, $updatedAt: now, $sequence: seq }
      rows(table).set($id, row)
      return { ...row }
    }),
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
        } else if (q.method === 'limit') {
          limit = Number(q.values?.[0] ?? 25)
        } else if (q.method === 'orderAsc' || q.method === 'orderDesc') {
          const dir = q.method === 'orderAsc' ? 1 : -1
          const key = q.attribute!
          list.sort((a, b) => (a[key]! > b[key]! ? dir : a[key]! < b[key]! ? -dir : 0))
        }
      }
      list = list.slice(0, limit)
      return { total: list.length, documents: list.map((r) => ({ ...r })) }
    }),
    updateDocument: vi.fn(async (_db: string, table: string, id: string, data: Record<string, unknown>) => {
      const row = rows(table).get(id)
      if (!row) throw new AppwriteError('Document not found', 404)
      const next = { ...row, ...data }
      checkUnique(table, next, id)
      rows(table).set(id, next)
      return { ...next }
    }),
    deleteDocument: vi.fn(async (_db: string, table: string, id: string) => {
      if (!rows(table).delete(id)) throw new AppwriteError('Document not found', 404)
    }),
    /** Test helper: raw rows of a table. */
    dump: (table: string) => [...rows(table).values()],
    /** Test helper: seed a row directly. */
    seed: (table: string, row: Record<string, unknown> & { $id: string }) => {
      rows(table).set(row.$id, { $createdAt: '', $updatedAt: '', ...row } as Row)
    },
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
}
