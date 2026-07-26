import type { ScopeOptions } from './types'

/**
 * Generic, string-keyed registration container shared by every collection
 * `createRegistry()` owns (kinds, pattern examples, data resolvers, data
 * source adapters, mutation resolvers, connection adapters, connections).
 * Deliberately not about making registered values self-describing — a
 * `DataResolver` stays a plain function; this only replaces hand-written
 * `Map<string, T>` CRUD repeated once per collection. A composite identity
 * (e.g. kinds' `apiVersion/kind`) is computed by the caller into a plain
 * string key before it ever reaches this container.
 */
export interface NamedRegistry<T> {
  register(key: string, value: T): void
  remove(key: string): void
  get(key: string): T | undefined
  list(): T[]
  keys(): string[]
}

export function createNamedRegistry<T>(): NamedRegistry<T> {
  const map = new Map<string, T>()
  return {
    register: (key, value) => {
      map.set(key, value)
    },
    remove: (key) => {
      map.delete(key)
    },
    get: (key) => map.get(key),
    list: () => [...map.values()],
    keys: () => [...map.keys()],
  }
}

/**
 * Only 2 of `createRegistry()`'s collections (kinds, connections) enforce
 * `registry.scope(options)` for real today — the rest silently passthrough,
 * because each `.scope()` override was hand-inlined per collection instead
 * of sharing one filtering shape. This combinator is that shared shape:
 * every collection re-expresses its own allow/deny + optional transform
 * logic as one `ScopeFilter`, and gets a consistently-filtered view for
 * free.
 */
export interface ScopeFilter<T> {
  /** `key` is the same string passed to `register` (source/target/type/kindKey/uid). */
  allowed(key: string, value: T, options: ScopeOptions): boolean
  /** Optional per-value transform after the allow check — e.g. a kind's slot/spec scoping. */
  transform?(value: T, options: ScopeOptions): T
}

export interface ScopedView<T> {
  get(key: string): T | undefined
  list(): T[]
  keys(): string[]
}

export function scopedView<T>(registry: NamedRegistry<T>, options: ScopeOptions, filter: ScopeFilter<T>): ScopedView<T> {
  const apply = (value: T) => (filter.transform ? filter.transform(value, options) : value)
  const entries = () => registry.keys().map((key) => [key, registry.get(key) as T] as const)
  const allowedEntries = () => entries().filter(([key, value]) => filter.allowed(key, value, options))

  return {
    get(key) {
      const value = registry.get(key)
      if (value === undefined || !filter.allowed(key, value, options)) return undefined
      return apply(value)
    },
    list() {
      return allowedEntries().map(([, value]) => apply(value))
    },
    keys() {
      return allowedEntries().map(([key]) => key)
    },
  }
}

/** Shared open-by-default allow/exclude check — same semantics as `kinds.include/exclude` already had, factored so every non-kind, non-connection collection can reuse it instead of hand-rolling the same conditional. */
export function allowListFilter(key: string, options?: { include?: string[]; exclude?: string[] }): boolean {
  if (options?.exclude?.includes(key)) return false
  return !options?.include || options.include.includes(key)
}
