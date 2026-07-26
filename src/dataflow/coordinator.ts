/**
 * Vendor-neutral server-state boundary between the document-level
 * `DataflowEngine` (`src/dataflow/engine.ts`) and a `DataSourceAdapter`
 * (docs/dataflow-and-server-state-direction.md P0 item 2). The engine never
 * talks to a coordinator directly — it only knows about `DataBinding`/
 * `resolve`; wiring a coordinator's background results back into the engine
 * goes through `onUpdate` below, published into `RuntimeStore`'s `dataflow`
 * namespace.
 *
 * `createDirectQueryCoordinator` is the only implementation here: no cache,
 * no polling, no dedup, no retry — it preserves a one-shot resolve
 * behavior. A TanStack Query (or other) coordinator is a separate,
 * pluggable implementation of the same `QueryCoordinator` contract (see
 * `createCoordinatorResolve` below for how either kind actually plugs into
 * the engine's resolve, and
 * `@loykin/resourcekit/dataflow/tanstack-query` for the TanStack-backed one).
 */

import { clampQueryPolicy } from '../runtime/queryPolicy'
import type { DataBinding, DataResolveContext, QueryPolicy, QueryScopePolicy } from '../core/types'
import type { ResourceRegistry } from '../core/registry'

export interface QueryRequest {
  nodeId: string
  key: readonly unknown[]
  execute(signal: AbortSignal): Promise<unknown>
  /** Host-clamped policy (see `clampQueryPolicy`) — `createDirectQueryCoordinator` ignores it; a scheduling coordinator (e.g. TanStack) reads it to configure polling/staleness/retry. */
  policy?: QueryPolicy
}

export type QueryStatus = 'pending' | 'ready' | 'error'

export interface QuerySnapshot {
  status: QueryStatus
  value?: unknown
  error?: unknown
}

export interface QueryHandle {
  getSnapshot(): QuerySnapshot
  subscribe(listener: () => void): () => void
  refetch(): Promise<void>
  dispose(): void
}

export interface QueryCoordinator {
  open(request: QueryRequest): QueryHandle
  /** Marks matching cache entries stale without executing them. */
  invalidate(nodeIds: string[]): Promise<void>
  /** Forces matching active handles to execute again. */
  refetch(nodeIds: string[]): Promise<void>
}

interface DirectEntry {
  request: QueryRequest
  snapshot: QuerySnapshot
  listeners: Set<() => void>
  controller: AbortController
  generation: number
}

export function createDirectQueryCoordinator(): QueryCoordinator {
  // Multiple handles could in principle open the same nodeId; invalidate/
  // refetch by nodeId must reach all of them regardless.
  const entriesByNodeId = new Map<string, Set<DirectEntry>>()

  function notify(entry: DirectEntry) {
    for (const listener of entry.listeners) listener()
  }

  // Generation-counter + AbortController supersession: a `DirectEntry` is a
  // single, self-contained query with no graph awareness, so a plain
  // incrementing `generation` field is the simplest correct mechanism for
  // discarding a stale in-flight execution when a newer one starts.
  function run(entry: DirectEntry) {
    const generation = ++entry.generation
    entry.controller.abort()
    entry.controller = new AbortController()
    entry.snapshot = { status: 'pending' }
    notify(entry)

    void entry.request
      .execute(entry.controller.signal)
      .then((value) => {
        if (generation !== entry.generation) return
        entry.snapshot = { status: 'ready', value }
        notify(entry)
      })
      .catch((error: unknown) => {
        if (generation !== entry.generation || entry.controller.signal.aborted) return
        entry.snapshot = { status: 'error', error }
        notify(entry)
      })
  }

  return {
    open(request) {
      const entry: DirectEntry = {
        request,
        snapshot: { status: 'pending' },
        listeners: new Set(),
        controller: new AbortController(),
        generation: 0,
      }
      const forNode = entriesByNodeId.get(request.nodeId) ?? new Set<DirectEntry>()
      forNode.add(entry)
      entriesByNodeId.set(request.nodeId, forNode)
      run(entry)

      return {
        getSnapshot: () => entry.snapshot,
        subscribe(listener) {
          entry.listeners.add(listener)
          return () => entry.listeners.delete(listener)
        },
        refetch: () => {
          run(entry)
          return Promise.resolve()
        },
        dispose() {
          entry.controller.abort()
          entry.listeners.clear()
          const forNode = entriesByNodeId.get(request.nodeId)
          forNode?.delete(entry)
          if (forNode && forNode.size === 0) entriesByNodeId.delete(request.nodeId)
        },
      }
    },
    async invalidate(nodeIds) {
      // A direct coordinator has no cache metadata to mark stale. Invalidation
      // deliberately does not execute; callers use refetch() for that.
      void nodeIds
    },
    async refetch(nodeIds) {
      for (const nodeId of nodeIds) {
        for (const entry of entriesByNodeId.get(nodeId) ?? []) run(entry)
      }
    },
  }
}

// Object-key order in an AI-authored binding is incidental, not semantic —
// sorting keys before stringifying keeps the fallback query key stable
// across two bindings that only differ in property order.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`
}

export interface CreateCoordinatorResolveOptions {
  coordinator: QueryCoordinator
  registry: Pick<ResourceRegistry, 'getDataSourceAdapter'>
  /** The actual row-fetching call (e.g. a plain `DataResolver` invocation) — this helper only adds coordinator semantics around it, it doesn't know how to fetch anything itself. */
  resolve: (binding: DataBinding, ctx: DataResolveContext) => Promise<unknown>
  /** Host ceiling applied via `clampQueryPolicy` before the policy reaches the coordinator. */
  scopePolicy?: QueryScopePolicy
  /**
   * Called whenever a node's coordinator-backed snapshot changes *after* the
   * value already delivered through `resolve`'s return promise — the only
   * way a coordinator's own background activity (a poll tick, an
   * out-of-band `invalidate`/`refetch`) reaches anything, since `resolve` is
   * otherwise a one-shot call. Wire this to publish into `RuntimeStore`'s
   * `dataflow` namespace (`runtimeKeys.dataflow(nodeId, scope)`) — the
   * `DataflowEngine` for that name reads directly off that same key. Safe to
   * ignore (e.g. a coordinator with no polling policy never calls this after
   * the first snapshot).
   */
  onUpdate?: (nodeId: string, snapshot: QuerySnapshot) => void
}

export interface CoordinatorResolveBridge {
  resolve: (
    binding: DataBinding,
    ctx: DataResolveContext & { nodeId: string; reason: 'initial' | 'refetch'; policy?: QueryPolicy },
  ) => Promise<unknown>
  /** Invalidates coordinator cache entries while suppressing same-value update echoes back to a mounted provider. */
  invalidate: (nodeIds: string[]) => Promise<void>
  /** Disposes every handle this bridge has opened — call when the owning runtime is torn down. */
  dispose: () => void
}

interface CachedHandle {
  /** Stringified form of `rawKey`, used only for this bridge's own "did the query key change" comparison — never sent to the coordinator. */
  cacheKey: string
  binding: DataBinding
  ctx: DataResolveContext
  handle: QueryHandle
  unsubscribeUpdates: () => void
  activeWaits: number
}

/**
 * Bridges any `QueryCoordinator` (direct or a scheduling one like TanStack
 * Query) into the `(binding, ctx) => Promise<unknown>` shape the
 * `DataflowEngine` needs (docs/dataflow-and-server-state-direction.md P1
 * item 1). Query key comes from a registered `DataSourceAdapter.queryKey`
 * when one exists for the binding's source; otherwise falls back to
 * `[nodeId, stableStringify(binding)]` when a source has no richer adapter
 * registration.
 *
 * Keeps exactly one `QueryHandle` per nodeId, reused across repeated
 * `resolve` calls for that node — not reopened every call. This is what
 * makes a scheduling coordinator's background updates actually reach
 * `onUpdate` (a fresh handle per call would settle its own promise once and
 * be abandoned, so a poll tick between calls would have nothing listening).
 * The cached handle is replaced (old one disposed) only when the computed
 * key changes — i.e. the unit's variable-dependent binding now refers to a
 * genuinely different query, not just a re-evaluation with the same one.
 */
export function createCoordinatorResolve(options: CreateCoordinatorResolveOptions): CoordinatorResolveBridge {
  const handles = new Map<string, CachedHandle>()

  function openHandle(
    nodeId: string,
    binding: DataBinding,
    rawKey: readonly unknown[],
    cacheKey: string,
    policy: QueryPolicy | undefined,
    ctx: DataResolveContext,
  ): CachedHandle {
    const cached: CachedHandle = {
      cacheKey,
      binding,
      ctx,
      // Placeholder until `coordinator.open()` returns below — `execute` only
      // reads `cached.binding`/`cached.ctx` (kept fresh on reuse), never
      // `cached.handle`, so the forward reference is safe.
      handle: undefined as unknown as QueryHandle,
      unsubscribeUpdates: () => {},
      activeWaits: 0,
    }
    const handle = options.coordinator.open({
      nodeId,
      key: rawKey,
      policy,
      execute: (execSignal) => options.resolve(cached.binding, { ...cached.ctx, signal: execSignal }),
    })
    cached.handle = handle
    cached.unsubscribeUpdates = handle.subscribe(() => {
      const snapshot = handle.getSnapshot()
      if (cached.activeWaits === 0 && (snapshot.status === 'ready' || snapshot.status === 'error')) {
        options.onUpdate?.(nodeId, snapshot)
      }
    })
    handles.set(nodeId, cached)
    return cached
  }

  return {
    async resolve(binding, ctx) {
      const adapter = options.registry.getDataSourceAdapter(binding.source)
      const rawKey = adapter ? adapter.queryKey(binding, ctx) : [ctx.nodeId, stableStringify(binding)]
      const cacheKey = stableStringify(rawKey)
      const policy = clampQueryPolicy(ctx.policy, options.scopePolicy)

      const existing = handles.get(ctx.nodeId)
      let cached: CachedHandle
      if (existing && existing.cacheKey === cacheKey) {
        existing.binding = binding
        existing.ctx = ctx
        cached = existing
      } else {
        existing?.unsubscribeUpdates()
        existing?.handle.dispose()
        cached = openHandle(ctx.nodeId, binding, rawKey, cacheKey, policy, ctx)
      }
      const handle = cached.handle
      cached.activeWaits++

      try {
        if (existing && existing.cacheKey === cacheKey && ctx.reason === 'refetch') {
          await handle.refetch()
        }

        return await new Promise<unknown>((resolvePromise, rejectPromise) => {
          let settled = false
          let unsubscribeSettle = () => {}
          const cleanup = () => {
            unsubscribeSettle()
            ctx.signal?.removeEventListener('abort', onAbort)
          }
          const trySettle = () => {
            if (settled) return
            const snapshot = handle.getSnapshot()
            if (snapshot.status === 'ready') {
              settled = true
              cleanup()
              resolvePromise(snapshot.value)
            } else if (snapshot.status === 'error') {
              settled = true
              cleanup()
              rejectPromise(snapshot.error)
            }
          }
          const onAbort = () => {
            // Only this call's wait is cancelled — the handle stays cached and
            // subscribed (via unsubscribeUpdates) for the next resolve() call
            // or background update; cancellation is per-call, not per-node.
            if (settled) return
            settled = true
            cleanup()
            rejectPromise(ctx.signal?.reason ?? new Error('aborted'))
          }

          unsubscribeSettle = handle.subscribe(trySettle)
          if (settled) {
            unsubscribeSettle()
            return
          }
          if (ctx.signal?.aborted) {
            onAbort()
            return
          }
          ctx.signal?.addEventListener('abort', onAbort, { once: true })
          trySettle()
        })
      } finally {
        cached.activeWaits--
      }
    },
    async invalidate(nodeIds) {
      const cachedHandles = nodeIds
        .map((nodeId) => handles.get(nodeId))
        .filter((cached): cached is CachedHandle => cached !== undefined)
      for (const cached of cachedHandles) cached.activeWaits++
      try {
        await options.coordinator.invalidate(nodeIds)
      } finally {
        for (const cached of cachedHandles) cached.activeWaits--
      }
    },
    dispose() {
      for (const cached of handles.values()) {
        cached.unsubscribeUpdates()
        cached.handle.dispose()
      }
      handles.clear()
    },
  }
}
