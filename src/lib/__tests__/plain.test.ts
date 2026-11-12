import { describe, expect, it } from 'vitest'
import { plainResults, toPlain } from '../plain'

function nullProto(fields: Record<string, unknown>) {
  return Object.assign(Object.create(null), fields)
}

describe('toPlain', () => {
  it('turns null-prototype rows (as json-bigint builds them) into plain objects, deeply', () => {
    const row = nullProto({ $id: 'e1', votePrice: 100, tags: [nullProto({ a: 1 })], nested: nullProto({ b: null }) })
    const out = toPlain({ total: 1, documents: [row] })
    const doc = out.documents[0]
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(doc.tags[0])).toBe(Object.prototype)
    expect(Object.getPrototypeOf(doc.nested)).toBe(Object.prototype)
    expect(doc).toEqual({ $id: 'e1', votePrice: 100, tags: [{ a: 1 }], nested: { b: null } })
  })

  it('leaves primitives, bigints and binary data alone', () => {
    const buf = new ArrayBuffer(4)
    expect(toPlain(buf)).toBe(buf)
    const big = BigInt('9007199254740993')
    expect(toPlain(big)).toBe(big)
    expect(toPlain(null)).toBe(null)
    expect(toPlain('x')).toBe('x')
  })
})

describe('plainResults', () => {
  it('normalises promise results and keeps `this` bound to the service', async () => {
    const service = {
      prefix: 'row',
      async getDocument(id: string) {
        return nullProto({ $id: `${this.prefix}-${id}` })
      },
    }
    const doc = await plainResults(service).getDocument('1')
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype)
    expect(doc).toEqual({ $id: 'row-1' })
  })
})
