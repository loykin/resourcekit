import type { Resource } from './types'

/**
 * Deep-sorts object keys lexicographically and drops `undefined`-valued
 * keys, recursively (human-editing-and-persistence.md #4). Arrays keep
 * their order — only object key order and undefined-omission vary between
 * otherwise-identical LLM outputs, so only those are normalized. This is
 * the precondition for "review an LLM edit's diff" to show only real
 * content changes instead of incidental key-order/whitespace noise.
 */
export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item === undefined) continue
      sorted[key] = canonicalizeJson(item)
    }
    return sorted
  }
  return value
}

/** Typed convenience wrapper over `canonicalizeJson` for a `Resource`. */
export function canonicalizeResource<TSpec = unknown>(resource: Resource<TSpec>): Resource<TSpec> {
  return canonicalizeJson(resource) as Resource<TSpec>
}

/** Canonicalizes, then serializes — same document in, same bytes out, regardless of source key order. */
export function canonicalStringify(value: unknown, space?: string | number): string {
  return JSON.stringify(canonicalizeJson(value), null, space)
}
