/**
 * Vendor-neutral server-state boundary between `DataflowRuntime` and a
 * `DataSourceAdapter` (docs/dataflow-and-server-state-direction.md P0
 * item 2). `DataflowRuntime` never talks to a coordinator directly — it only
 * knows about `DataBinding`/`resolve`; wiring a coordinator's results into a
 * dataflow epoch goes through `DataflowRuntime.publish()`.
 *
 * `createDirectQueryCoordinator` is the only implementation here: no cache,
 * no polling, no dedup, no retry — it preserves today's one-shot resolve
 * behavior. A TanStack Query (or other) coordinator is a separate,
 * pluggable implementation of the same `QueryCoordinator` contract.
 */

export interface QueryRequest {
  nodeId: string
  key: readonly unknown[]
  execute(signal: AbortSignal): Promise<unknown>
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
  invalidate(nodeIds: string[]): Promise<void>
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
  // Multiple handles may open the same nodeId (e.g. two resources consuming
  // one resolve node); invalidate/refetch by nodeId must reach all of them.
  const entriesByNodeId = new Map<string, Set<DirectEntry>>()

  function notify(entry: DirectEntry) {
    for (const listener of entry.listeners) listener()
  }

  // Generation-counter + AbortController supersession, same idea as
// src/dataflow.ts's per-node cancellation (evaluate()/evaluateAffected,
// ObsoleteExecutionError). Deliberately not shared: dataflow.ts tracks
// generations for many graph nodes at once via external `Map<string,
// number>` + `Map<string, AbortController>` lookups (needed because a
// node's cancellation is driven by *other* nodes changing), while a
// DirectEntry here is a single, self-contained query with no graph
// awareness at all. Forcing one shape onto the other would either make
// dataflow.ts's already-delicate multi-node bookkeeping indirect for no
// reason, or make this file carry map lookups it doesn't need — see
// AGENTS.md on not introducing abstractions beyond what's required. If a
// third cancellation site appears, that's the signal to actually extract one.
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
      // No cache to mark stale — refetching immediately is the closest
      // equivalent for a coordinator that never retains a previous result.
      for (const nodeId of nodeIds) {
        for (const entry of entriesByNodeId.get(nodeId) ?? []) run(entry)
      }
    },
    async refetch(nodeIds) {
      for (const nodeId of nodeIds) {
        for (const entry of entriesByNodeId.get(nodeId) ?? []) run(entry)
      }
    },
  }
}
