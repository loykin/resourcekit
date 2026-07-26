/**
 * Lets a `SubmitEffect` (`invalidateData`/`refetchData`) fired by *any* kind
 * *anywhere* in the tree reach a named `scopeProvider: true` kind instance by
 * stable name, regardless of tree position — the one thing plain
 * ancestor→descendant prop flow can't do (see
 * docs/dataflow-and-server-state-direction.md's terminal decision entry).
 *
 * Deliberately a plain in-memory side-table of function callbacks, not
 * routed through `RuntimeStore` — a live "please refetch" callback is
 * command semantics, which `RuntimeStore` must never gain (AGENTS.md).
 */
export interface ScopeRegistration {
  /** Forces re-execution regardless of whether anything changed. */
  refetch(): Promise<void>
  /** Marks the provider's current value stale in place, no re-fetch. */
  invalidate(): void
}

export interface ScopeRegistry {
  register(name: string, registration: ScopeRegistration): () => void
  refetch(names: string[]): Promise<void>
  invalidate(names: string[]): void
}

export function createScopeRegistry(): ScopeRegistry {
  const registrations = new Map<string, Set<ScopeRegistration>>()

  return {
    register(name, registration) {
      const set = registrations.get(name) ?? new Set<ScopeRegistration>()
      set.add(registration)
      registrations.set(name, set)
      return () => {
        set.delete(registration)
        if (set.size === 0) registrations.delete(name)
      }
    },
    async refetch(names) {
      await Promise.all(names.flatMap((name) => [...(registrations.get(name) ?? [])].map((registration) => registration.refetch())))
    },
    invalidate(names) {
      for (const name of names) {
        for (const registration of registrations.get(name) ?? []) registration.invalidate()
      }
    },
  }
}
