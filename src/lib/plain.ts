/**
 * node-appwrite parses responses with json-bigint, which builds every object
 * with a null prototype. React refuses those as props to Client Components
 * ("Classes or null prototypes are not supported"), so the admin client hands
 * back plain copies instead (`plainResults` in `appwrite-server.ts`).
 */
export function toPlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(toPlain) as T
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto === null || proto === Object.prototype) {
      const out: Record<string, unknown> = {}
      for (const [key, v] of Object.entries(value)) out[key] = toPlain(v)
      return out as T
    }
  }
  // Primitives, bigints, Dates, Buffers, ArrayBuffers and class instances pass through untouched.
  return value
}

/** Wraps an SDK service so every method that returns a promise resolves to plain objects. */
export function plainResults<S extends object>(service: S): S {
  return new Proxy(service, {
    get(target, prop, receiver) {
      const member = Reflect.get(target, prop, receiver)
      if (typeof member !== 'function') return member
      return (...args: unknown[]) => {
        const result = member.apply(target, args)
        return result instanceof Promise ? result.then(toPlain) : result
      }
    },
  })
}
