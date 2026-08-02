import { canonicalStringify } from '../core/canonical'
import type { DataBinding, DataResolveContext, DataflowUnit, QueryScopePolicy } from '../core/types'
import { clampQueryPolicy } from '../runtime/queryPolicy'
import { runtimeKeys } from '../runtime/store'
import type { RuntimeStatus, RuntimeStore } from '../runtime/store'
import { interpolate, scanVariableRefs } from '../runtime/variables'
import type { VariableEngine } from '../runtime/variables'
import type { CoordinatorResolveBridge } from './coordinator'

/**
 * Single, document-level owner of every declared `dataflow` unit's fetch
 * lifecycle. Replaces the old per-mounted-component `ScopeProviderNode`
 * model: with exactly one engine instance per `ResourceRenderer` mount,
 * there is exactly one in-flight fetch per name, so superseding a stale one
 * is trivial closure state — no cross-component registry, no per-mount
 * generation guard.
 */
export interface DataflowEngine {
  /** Seeds every declared unit and kicks off eager (no-`dependOn`) fetches. Call once, in a `useEffect` (not `useMemo`) — this has side effects (network calls). */
  declare(units: DataflowUnit[]): void
  /** Current resolved rows for a unit — undefined while pending/never-run. */
  read(name: string): unknown
  status(name: string): RuntimeStatus | undefined
  /** Forces re-execution regardless of fingerprint dedup. */
  refetch(names: string[]): Promise<void>
  /** Marks matching units' current value stale in place — no re-fetch (mirrors `QueryCoordinator.invalidate`'s contract). */
  invalidate(names: string[]): void
  /** Tears down every internal store subscription and disposes the coordinator bridge, if any. Call on `ResourceRenderer` unmount. */
  dispose(): void
}

export interface CreateDataflowEngineOptions {
  store: RuntimeStore
  scope: string
  variables: VariableEngine
  /** The actual row-fetching call for the no-coordinator path — this engine only adds dependOn-gating/dedup/status-tracking around it. */
  resolve: (binding: DataBinding, ctx: DataResolveContext) => Promise<Record<string, unknown>[]>
  /** Push/streaming path — called instead of `resolve` when the manifest supports it. Returns `undefined` if the binding's manifest has no `subscribe`. */
  subscribe?: (binding: DataBinding, onData: (rows: Record<string, unknown>[]) => void, ctx: DataResolveContext) => (() => void) | undefined
  coordinatorResolve?: CoordinatorResolveBridge
  scopePolicy?: QueryScopePolicy
}

export function createDataflowEngine(options: CreateDataflowEngineOptions): DataflowEngine {
  const { store, scope, variables, resolve, subscribe, coordinatorResolve, scopePolicy } = options

  const units = new Map<string, DataflowUnit>()
  const generations = new Map<string, number>()
  const lastFingerprint = new Map<string, string>()
  const streamTeardowns = new Map<string, () => void>()
  let unsubscribers: Array<() => void> = []

  const keyFor = (name: string) => runtimeKeys.dataflow(name, scope)
  const statusOf = (name: string): RuntimeStatus | undefined => store.read(keyFor(name))?.status

  async function attempt(name: string, opts: { force?: boolean } = {}): Promise<void> {
    const unit = units.get(name)
    if (!unit) return

    const interpolated = interpolate(unit.binding, variables.snapshot())
    if (interpolated.unresolved.size > 0) return

    for (const dep of unit.dependOn ?? []) {
      if (statusOf(dep) !== 'ready') return
    }

    const fingerprint = canonicalStringify(interpolated.value)
    if (!opts.force && lastFingerprint.get(name) === fingerprint && statusOf(name) === 'ready') return

    const generation = (generations.get(name) ?? 0) + 1
    generations.set(name, generation)

    // Tear down any existing stream subscription before re-attempting
    streamTeardowns.get(name)?.();
    streamTeardowns.delete(name)

    store.publish(keyFor(name), { status: 'pending' })

    // Try push/streaming path first — coordinator is skipped for streaming sources
    if (subscribe) {
      const teardown = subscribe(
        interpolated.value as DataBinding,
        (rows) => {
          if (generations.get(name) !== generation) return
          lastFingerprint.set(name, fingerprint)
          store.publish(keyFor(name), { status: 'ready', value: rows })
        },
        { variables: variables.snapshot() },
      )
      if (teardown !== undefined) {
        streamTeardowns.set(name, teardown)
        return
      }
    }

    try {
      const value = coordinatorResolve
        ? await coordinatorResolve.resolve(interpolated.value as DataBinding, {
            variables: variables.snapshot(),
            nodeId: name,
            reason: opts.force ? 'refetch' : 'initial',
            policy: clampQueryPolicy(unit.policy, scopePolicy),
          })
        : await resolve(interpolated.value as DataBinding, { variables: variables.snapshot() })
      if (generations.get(name) !== generation) return
      lastFingerprint.set(name, fingerprint)
      store.publish(keyFor(name), { status: 'ready', value })
    } catch (error) {
      // Dependents stay gated forever on an errored upstream unit — a
      // deliberate simplification; there is no automatic retry-on-recovery
      // path beyond whatever re-triggers `attempt` (a variable change, an
      // explicit refetch, or a coordinator's own polling).
      if (generations.get(name) !== generation) return
      store.publish(keyFor(name), { status: 'error', error })
    }
  }

  return {
    declare(newUnits) {
      for (const unsub of unsubscribers) unsub()
      unsubscribers = []
      units.clear()
      generations.clear()
      lastFingerprint.clear()

      for (const unit of newUnits) units.set(unit.name, unit)

      for (const unit of newUnits) {
        for (const ref of scanVariableRefs(unit.binding)) {
          unsubscribers.push(
            store.subscribe({ kind: 'key', key: runtimeKeys.variable(ref, scope) }, () => {
              void attempt(unit.name)
            }),
          )
        }
        for (const dep of unit.dependOn ?? []) {
          unsubscribers.push(
            store.subscribe({ kind: 'key', key: keyFor(dep) }, ({ snapshot }) => {
              if (snapshot?.status === 'ready') void attempt(unit.name)
            }),
          )
        }
      }

      for (const unit of newUnits) void attempt(unit.name)
    },
    read(name) {
      return store.read(keyFor(name))?.value
    },
    status(name) {
      return statusOf(name)
    },
    async refetch(names) {
      await Promise.all(names.map((name) => attempt(name, { force: true })))
    },
    invalidate(names) {
      if (coordinatorResolve) {
        void coordinatorResolve.invalidate(names)
        return
      }
      for (const name of names) {
        store.publish(keyFor(name), { ...(store.read(keyFor(name)) ?? { status: 'idle' }), isStale: true })
      }
    },
    dispose() {
      for (const unsub of unsubscribers) unsub()
      for (const teardown of streamTeardowns.values()) teardown()
      unsubscribers = []
      units.clear()
      generations.clear()
      lastFingerprint.clear()
      streamTeardowns.clear()
      coordinatorResolve?.dispose()
    },
  }
}
