import { getValueAtPath, setValueAtPath } from './path'
import type { DataBinding, DataRef, QueryScopePolicy, Resource } from './types'

export type { DataRef } from './types'

export interface StateDataNode {
  kind: 'state'
  initialValue?: unknown
  lifecycle?: 'ephemeral' | 'page' | 'session' | 'persistent'
}

/**
 * AI-authored server-state policy for a `resolve` node
 * (docs/dataflow-and-server-state-direction.md). Vocabulary is
 * resourcekit-generic, never a specific query library's option names —
 * `clampQueryPolicy` enforces the host's `QueryScopePolicy` ceiling on it.
 */
export interface QueryPolicy {
  refresh?: { kind: 'interval'; ms: number }
  staleForMs?: number
  retainPreviousData?: boolean
  retry?: { maxAttempts: number }
}

export interface ResolveDataNode {
  kind: 'resolve'
  binding: DataBinding
  policy?: QueryPolicy
}

/**
 * Applies a host's `QueryScopePolicy` ceiling to an AI-authored `QueryPolicy`
 * — never rejects, always returns a policy the host has already agreed to
 * run (docs/dataflow-and-server-state-direction.md: "runtime은 1초로 clamp").
 */
export function clampQueryPolicy(policy: QueryPolicy | undefined, scope: QueryScopePolicy | undefined): QueryPolicy | undefined {
  if (!policy) return policy

  const clamped: QueryPolicy = { ...policy }

  if (clamped.refresh) {
    if (scope?.allowPolling === false) {
      delete clamped.refresh
    } else {
      let ms = clamped.refresh.ms
      if (scope?.minIntervalMs !== undefined) ms = Math.max(ms, scope.minIntervalMs)
      if (scope?.maxIntervalMs !== undefined) ms = Math.min(ms, scope.maxIntervalMs)
      clamped.refresh = { ...clamped.refresh, ms }
    }
  }

  if (clamped.retry && scope?.maxRetries !== undefined) {
    clamped.retry = { ...clamped.retry, maxAttempts: Math.min(clamped.retry.maxAttempts, scope.maxRetries) }
  }

  return clamped
}

export type DataNode = StateDataNode | ResolveDataNode

export interface DataGraphSpec {
  nodes: Record<string, DataNode>
}

export interface ResourceDocument {
  data?: DataGraphSpec
  resource: Resource
}

export type DataStatus = 'idle' | 'pending' | 'ready' | 'error'

/** Network activity, independent of `status` (data availability) — see docs/dataflow-and-server-state-direction.md "Snapshot 확장". */
export type FetchStatus = 'idle' | 'fetching' | 'paused'

export interface DataSnapshot<T = unknown> {
  status: DataStatus
  value?: T
  error?: unknown
  version: number
  updatedAt?: number
  epoch: number
  /** Set by a `QueryCoordinator` via `publish()`; internal resolver-driven writes leave this unset. */
  fetchStatus?: FetchStatus
  /** True when `value`/`error` are from a previous, superseded fetch — a `retainPreviousData` policy keeps showing them while newer data loads or a refresh fails. */
  isStale?: boolean
}

type MaybePromise<T> = T | Promise<T>

export interface DataStore {
  read(id: string): MaybePromise<DataSnapshot | undefined>
  write(id: string, snapshot: DataSnapshot): MaybePromise<void>
  remove(id: string): MaybePromise<void>
  subscribe(id: string, listener: () => void): () => void
}

export interface DataGraphIssue {
  code: 'invalid-node' | 'invalid-ref' | 'missing-ref' | 'cycle'
  path: string
  message: string
}

export interface DataGraphValidationResult {
  valid: boolean
  issues: DataGraphIssue[]
}

export interface DataNodeResolveContext {
  signal: AbortSignal
  nodeId: string
  epoch: number
}

export interface CreateDataflowRuntimeOptions {
  graph: DataGraphSpec
  store?: DataStore
  resolve(binding: DataBinding, context: DataNodeResolveContext): Promise<unknown>
}

/**
 * Outcome of a resolve node's execution, produced outside `options.resolve`
 * — see `DataflowRuntime.publish`. The `error` variant may carry a `value`
 * alongside it: a `retainPreviousData` refresh that fails should still show
 * the last-good payload while reporting the new failure (`isStale: true`).
 */
export type PublishResult =
  | { status: 'ready'; value: unknown; isStale?: boolean; fetchStatus?: FetchStatus }
  | { status: 'error'; error: unknown; value?: unknown; isStale?: boolean; fetchStatus?: FetchStatus }

export interface StatePatch {
  id: string
  /** Non-empty dot-path — use `setState`/`setStates` to replace a node's whole value. */
  path: string
  value: unknown
}

export interface DataflowRuntime {
  start(): Promise<void>
  read(id: string): Promise<DataSnapshot | undefined>
  resolve(id: string): Promise<unknown>
  setState(id: string, value: unknown): Promise<void>
  setStates(values: Record<string, unknown>): Promise<void>
  /**
   * Immutably updates one sub-field of a state node's current value,
   * leaving the rest untouched — the write-side counterpart to
   * `DataRef.path` reads (docs/dataflow-and-server-state-direction.md
   * "Resource binding에서 필요한 수정"). Without this, a writable binding
   * with a `path` would have no way to change just that field: `setState`
   * always replaces the whole node.
   */
  setStatePath(id: string, path: string, value: unknown): Promise<void>
  /** Batched form of `setStatePath` — patches to the same id apply in order within one epoch, so several controlled inputs sharing one draft object stay consistent. */
  setStatePaths(patches: StatePatch[]): Promise<void>
  /**
   * Publishes a `resolve` node result produced out of band — by a
   * `QueryCoordinator`'s background refetch/poll, not by this runtime's own
   * `options.resolve` call — into the dataflow epoch (docs/dataflow-and-
   * server-state-direction.md P0 item 4). Opens a new epoch, supersedes any
   * in-flight internal evaluation of `id`, and re-evaluates only `id`'s
   * descendants — the same fan-in-consistent path `setState` uses for its
   * own writes.
   */
  publish(id: string, result: PublishResult): Promise<void>
  /**
   * Marks `resolve` nodes' current snapshots stale in place — value/error
   * kept, no re-execution (docs/dataflow-and-server-state-direction.md
   * "Mutation과 invalidation": a mutation's `invalidateData` effect). Pair
   * with `refetch` to actually reload; a coordinator-backed node may prefer
   * to just show a "stale" indicator until its own next poll instead.
   *
   * This is a graph-level primitive, independent of whether a
   * `QueryCoordinator` is wired in: it operates only on this runtime's own
   * snapshots, never on a coordinator's cache. When a coordinator *is*
   * wired (P1 item 1, not yet implemented), the coordinator-aware path is
   * `options.resolve` itself calling into the coordinator — not this method
   * reaching into `QueryCoordinator`. That keeps `DataflowRuntime` ignorant
   * of `QueryCoordinator` by construction (see queryCoordinator.ts's own
   * top-of-file note) rather than needing a special case here.
   */
  invalidate(ids: string[]): Promise<void>
  /**
   * Forces a fresh internal execution of `resolve` nodes and their
   * descendants, ignoring whether any dependency actually changed — a
   * mutation's `refetchData` effect. Unlike `publish`, this re-runs
   * `options.resolve` itself rather than accepting an externally-produced
   * value — so once a node's `resolve` is coordinator-backed, this
   * transparently re-runs *through* the coordinator too. See `invalidate`'s
   * note on why this stays graph-level rather than becoming coordinator-aware.
   */
  refetch(ids: string[]): Promise<void>
  subscribe(listener: (id: string, snapshot: DataSnapshot) => void): () => void
  dispose(): void
}

export class DataGraphValidationError extends Error {
  readonly issues: DataGraphIssue[]

  constructor(issues: DataGraphIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
    this.name = 'DataGraphValidationError'
    this.issues = issues
  }
}

export function isDataRef(value: unknown): value is DataRef {
  if (!isRecord(value) || typeof value.$data !== 'string') return false
  if (value.path !== undefined && typeof value.path !== 'string') return false
  return Object.keys(value).every((key) => key === '$data' || key === 'path')
}

export function scanDataRefs(value: unknown): DataRef[] {
  const refs: DataRef[] = []

  const visit = (current: unknown) => {
    if (isDataRef(current)) {
      refs.push(current)
      return
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }
    if (isRecord(current)) {
      for (const item of Object.values(current)) visit(item)
    }
  }

  visit(value)
  return refs
}

export function resolveDataRefs(value: unknown, snapshots: ReadonlyMap<string, DataSnapshot>): unknown {
  if (isDataRef(value)) {
    const snapshot = snapshots.get(value.$data)
    if (!snapshot || snapshot.status !== 'ready') {
      throw new Error(`Data reference ${value.$data} is not ready`)
    }
    return value.path ? getValueAtPath(snapshot.value, value.path) : snapshot.value
  }
  if (Array.isArray(value)) return value.map((item) => resolveDataRefs(item, snapshots))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveDataRefs(item, snapshots)]))
}

export function validateDataGraph(graph: DataGraphSpec): DataGraphValidationResult {
  const issues: DataGraphIssue[] = []
  const edges = new Map<string, Set<string>>()

  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!id) {
      issues.push({ code: 'invalid-node', path: 'data.nodes', message: 'node id must not be empty' })
      continue
    }
    if (node.kind !== 'state' && node.kind !== 'resolve') {
      issues.push({ code: 'invalid-node', path: `data.nodes.${id}.kind`, message: `unsupported node kind ${(node as { kind?: unknown }).kind}` })
      continue
    }
    const dependencies = new Set<string>()
    if (node.kind === 'resolve') {
      collectRefIssues(node.binding, `data.nodes.${id}.binding`, issues)
      for (const ref of scanDataRefs(node.binding)) {
        dependencies.add(ref.$data)
        if (!(ref.$data in graph.nodes)) {
          issues.push({
            code: 'missing-ref',
            path: `data.nodes.${id}.binding`,
            message: `referenced node ${ref.$data} does not exist`,
          })
        }
      }
    }
    edges.set(id, dependencies)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (id: string, trail: string[]) => {
    if (visiting.has(id)) {
      const start = trail.indexOf(id)
      const cycle = [...trail.slice(start), id]
      issues.push({ code: 'cycle', path: `data.nodes.${id}`, message: `dependency cycle: ${cycle.join(' -> ')}` })
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of edges.get(id) ?? []) {
      if (dependency in graph.nodes) visit(dependency, [...trail, id])
    }
    visiting.delete(id)
    visited.add(id)
  }

  for (const id of Object.keys(graph.nodes)) visit(id, [])
  return { valid: issues.length === 0, issues }
}

export function createMemoryDataStore(): DataStore {
  const snapshots = new Map<string, DataSnapshot>()
  const listeners = new Map<string, Set<() => void>>()

  const notify = (id: string) => {
    for (const listener of listeners.get(id) ?? []) listener()
  }

  return {
    read: (id) => snapshots.get(id),
    write(id, snapshot) {
      snapshots.set(id, snapshot)
      notify(id)
    },
    remove(id) {
      snapshots.delete(id)
      notify(id)
    },
    subscribe(id, listener) {
      const nodeListeners = listeners.get(id) ?? new Set<() => void>()
      nodeListeners.add(listener)
      listeners.set(id, nodeListeners)
      return () => {
        nodeListeners.delete(listener)
        if (nodeListeners.size === 0) listeners.delete(id)
      }
    },
  }
}

class ObsoleteExecutionError extends Error {}

export function createDataflowRuntime(options: CreateDataflowRuntimeOptions): DataflowRuntime {
  const validation = validateDataGraph(options.graph)
  if (!validation.valid) throw new DataGraphValidationError(validation.issues)

  const store = options.store ?? createMemoryDataStore()
  const dependencies = new Map<string, Set<string>>()
  const dependents = new Map<string, Set<string>>()
  const generations = new Map<string, number>()
  const controllers = new Map<string, AbortController>()
  const listeners = new Set<(id: string, snapshot: DataSnapshot) => void>()
  let epoch = 0
  let version = 0
  let initialized: Promise<void> | undefined
  let started: Promise<void> | undefined
  let disposed = false
  // One ordered queue for both whole-value sets and path patches, so their
  // relative call order within a tick is preserved — see ensureScheduledWrite.
  const pendingOps: Array<{ kind: 'set'; id: string; value: unknown } | { kind: 'patch'; id: string; path: string; value: unknown }> = []
  let scheduledWrite: Promise<void> | undefined

  for (const [id, node] of Object.entries(options.graph.nodes)) {
    const refs = node.kind === 'resolve' ? scanDataRefs(node.binding) : []
    const nodeDependencies = new Set(refs.map((ref) => ref.$data))
    dependencies.set(id, nodeDependencies)
    generations.set(id, 0)
    for (const dependency of nodeDependencies) {
      const downstream = dependents.get(dependency) ?? new Set<string>()
      downstream.add(id)
      dependents.set(dependency, downstream)
    }
  }

  const writeSnapshot = async (id: string, snapshot: Omit<DataSnapshot, 'version' | 'updatedAt'>) => {
    version++
    const next = { ...snapshot, version, updatedAt: Date.now() }
    await store.write(id, next)
    for (const listener of listeners) listener(id, next)
  }

  const waitForSettled = (id: string): Promise<DataSnapshot> => {
    // Subscribe *before* checking the current snapshot — reading first and
    // subscribing second leaves a window where a node can settle between the
    // read and the subscribe call, so the notification that would have
    // resolved this promise fires into nothing and it hangs forever.
    return new Promise((resolve) => {
      const settleIfReady = (snapshot: DataSnapshot | undefined, unsubscribe: () => void) => {
        if (!snapshot || snapshot.status === 'pending' || snapshot.status === 'idle') return
        unsubscribe()
        resolve(snapshot)
      }
      const unsubscribe = store.subscribe(id, () => {
        void Promise.resolve(store.read(id)).then((snapshot) => settleIfReady(snapshot, unsubscribe))
      })
      void Promise.resolve(store.read(id)).then((snapshot) => settleIfReady(snapshot, unsubscribe))
    })
  }

  const affectedFrom = (ids: Iterable<string>): Set<string> => {
    const affected = new Set<string>()
    const queue = [...ids]
    while (queue.length > 0) {
      const id = queue.shift()
      if (!id) continue
      for (const dependent of dependents.get(id) ?? []) {
        if (affected.has(dependent)) continue
        affected.add(dependent)
        queue.push(dependent)
      }
    }
    return affected
  }

  const evaluateAffected = async (affected: Set<string>, batchEpoch: number) => {
    const memo = new Map<string, Promise<DataSnapshot>>()

    const evaluate = (id: string): Promise<DataSnapshot> => {
      const existing = memo.get(id)
      if (existing) return existing

      const promise = (async () => {
        const node = options.graph.nodes[id]
        if (node.kind === 'state' || !affected.has(id)) {
          const snapshot = await store.read(id)
          // A dependency outside this batch's affected set (e.g. a resolve
          // node `publish()` just wrote directly) can itself be in `error`
          // status — propagate its real error instead of a generic "not
          // ready" message that would swallow it.
          if (snapshot?.status === 'error') throw snapshot.error
          if (!snapshot || snapshot.status !== 'ready') throw new Error(`Data node ${id} is not ready`)
          return snapshot
        }

        const generation = generations.get(id) ?? 0
        await writeSnapshot(id, { status: 'pending', epoch: batchEpoch })
        let controller: AbortController | undefined

        try {
          const upstream = new Map<string, DataSnapshot>()
          await Promise.all(
            [...(dependencies.get(id) ?? [])].map(async (dependency) => {
              upstream.set(dependency, await evaluate(dependency))
            }),
          )
          if (generation !== generations.get(id)) return Promise.reject(new ObsoleteExecutionError())

          const binding = resolveDataRefs(node.binding, upstream) as DataBinding
          controller = new AbortController()
          controllers.set(id, controller)
          const value = await options.resolve(binding, { signal: controller.signal, nodeId: id, epoch: batchEpoch })
          if (generation !== generations.get(id) || controller.signal.aborted) return Promise.reject(new ObsoleteExecutionError())
          await writeSnapshot(id, { status: 'ready', value, epoch: batchEpoch })
          return (await store.read(id)) as DataSnapshot
        } catch (error) {
          if (error instanceof ObsoleteExecutionError || controller?.signal.aborted || generation !== generations.get(id)) {
            throw new ObsoleteExecutionError()
          }
          await writeSnapshot(id, { status: 'error', error, epoch: batchEpoch })
          throw error
        } finally {
          if (controller && controllers.get(id) === controller) controllers.delete(id)
        }
      })()

      memo.set(id, promise)
      return promise
    }

    await Promise.allSettled([...affected].map((id) => evaluate(id)))
  }

  const requireActive = async () => {
    if (disposed) throw new Error('Dataflow runtime is disposed')
    await ensureInitialized()
  }

  const applyStateBatch = async (values: Map<string, unknown>) => {
    await requireActive()
    for (const id of values.keys()) {
      if (options.graph.nodes[id]?.kind !== 'state') throw new Error(`Data node ${id} is not writable state`)
    }

    epoch++
    const batchEpoch = epoch
    await Promise.all(
      [...values.entries()].map(([id, value]) => writeSnapshot(id, { status: 'ready', value, epoch: batchEpoch })),
    )

    const affected = affectedFrom(values.keys())
    for (const id of affected) {
      generations.set(id, (generations.get(id) ?? 0) + 1)
      controllers.get(id)?.abort()
    }
    await evaluateAffected(affected, batchEpoch)
  }

  const publishResult = async (id: string, result: PublishResult) => {
    await requireActive()
    requireResolveNodes([id])

    epoch++
    const batchEpoch = epoch

    // Supersede any in-flight internal evaluation of `id` itself — without
    // this, a same-node resolver call already in progress could still land
    // after this externally-produced result and overwrite it.
    generations.set(id, (generations.get(id) ?? 0) + 1)
    controllers.get(id)?.abort()
    await writeSnapshot(id, { ...result, epoch: batchEpoch })

    const affected = affectedFrom([id])
    for (const dependent of affected) {
      generations.set(dependent, (generations.get(dependent) ?? 0) + 1)
      controllers.get(dependent)?.abort()
    }
    await evaluateAffected(affected, batchEpoch)
  }

  const requireResolveNodes = (ids: string[]) => {
    for (const id of ids) {
      const node = options.graph.nodes[id]
      if (!node) throw new Error(`Data node ${id} does not exist`)
      if (node.kind !== 'resolve') throw new Error(`Data node ${id} is not a resolve node`)
    }
  }

  const invalidateNodes = async (ids: string[]) => {
    await requireActive()
    requireResolveNodes(ids)
    await Promise.all(
      ids.map(async (id) => {
        const snapshot = await store.read(id)
        if (!snapshot) return
        const { version: _version, updatedAt: _updatedAt, ...rest } = snapshot
        await writeSnapshot(id, { ...rest, isStale: true })
      }),
    )
  }

  const refetchNodes = async (ids: string[]) => {
    await requireActive()
    requireResolveNodes(ids)

    epoch++
    const batchEpoch = epoch
    const affected = new Set(ids)
    for (const dependent of affectedFrom(ids)) affected.add(dependent)
    for (const id of affected) {
      generations.set(id, (generations.get(id) ?? 0) + 1)
      controllers.get(id)?.abort()
    }
    await evaluateAffected(affected, batchEpoch)
  }

  // A same tick may mix whole-value setState calls and setStatePath patches
  // for the same node in either order (e.g. a "reset to defaults" action and
  // a field's onChange firing in the same batch). Both queue into one
  // ordered list synchronously — push happens before any await — so
  // back-to-back calls can never race on reading the same pre-batch
  // snapshot as their base, and a later whole-value setState correctly wins
  // over an earlier same-tick patch (and vice versa) because the microtask
  // below replays every op in exact push order, not "all sets then all
  // patches."
  const ensureScheduledWrite = (): Promise<void> => {
    if (!scheduledWrite) {
      scheduledWrite = Promise.resolve().then(async () => {
        const ops = pendingOps.splice(0)
        scheduledWrite = undefined

        if (ops.some((op) => op.kind === 'patch')) await ensureInitialized()

        // An id only needs its committed value fetched as a patch base if
        // the *first* op touching it in this batch is a patch — anything
        // preceded by a same-batch `set` builds on that in-memory value
        // instead. Distinct ids' store reads are independent I/O, so fetch
        // them concurrently instead of one at a time in patch order.
        const seenIds = new Set<string>()
        const idsNeedingBase = new Set<string>()
        for (const op of ops) {
          if (seenIds.has(op.id)) continue
          seenIds.add(op.id)
          if (op.kind === 'patch') idsNeedingBase.add(op.id)
        }
        const bases = new Map<string, unknown>()
        await Promise.all(
          [...idsNeedingBase].map(async (id) => {
            const snapshot = await store.read(id)
            bases.set(id, snapshot?.status === 'ready' ? snapshot.value : undefined)
          }),
        )

        // Purely synchronous now that every needed base is pre-fetched —
        // replays ops in exact push order, so a later same-tick setState
        // still wins over an earlier setStatePath to the same node, and
        // vice versa.
        const writes = new Map<string, unknown>()
        for (const op of ops) {
          if (op.kind === 'set') {
            writes.set(op.id, op.value)
            continue
          }
          const base = writes.has(op.id) ? writes.get(op.id) : bases.get(op.id)
          writes.set(op.id, setValueAtPath(base, op.path, op.value))
        }
        return applyStateBatch(writes)
      })
    }
    return scheduledWrite
  }

  const scheduleStateBatch = (values: Record<string, unknown>): Promise<void> => {
    for (const [id, value] of Object.entries(values)) pendingOps.push({ kind: 'set', id, value })
    return ensureScheduledWrite()
  }

  // `async` only so a bad path rejects the returned promise instead of
  // throwing synchronously — the push itself still runs before any await,
  // same timing as a plain function.
  const scheduleStatePathBatch = async (patches: StatePatch[]): Promise<void> => {
    for (const patch of patches) {
      if (!patch.path) throw new Error(`setStatePath requires a non-empty path (node ${patch.id}); use setState for the whole value`)
    }
    for (const patch of patches) pendingOps.push({ kind: 'patch', id: patch.id, path: patch.path, value: patch.value })
    return ensureScheduledWrite()
  }

  const ensureInitialized = (): Promise<void> => {
    if (initialized) return initialized
    initialized = (async () => {
      epoch++
      const initialEpoch = epoch
      for (const [id, node] of Object.entries(options.graph.nodes)) {
        if (node.kind !== 'state') continue
        const existing = await store.read(id)
        if (!existing) await writeSnapshot(id, { status: 'ready', value: node.initialValue, epoch: initialEpoch })
      }
    })()
    return initialized
  }

  const ensureStarted = (): Promise<void> => {
    if (started) return started
    started = (async () => {
      await ensureInitialized()
      const initialEpoch = epoch
      const resolvers = new Set(
        Object.entries(options.graph.nodes)
          .filter(([, node]) => node.kind === 'resolve')
          .map(([id]) => id),
      )
      await evaluateAffected(resolvers, initialEpoch)
    })()
    return started
  }

  return {
    start: ensureStarted,
    read: (id) => Promise.resolve(store.read(id)),
    async resolve(id) {
      if (!(id in options.graph.nodes)) throw new Error(`Data node ${id} does not exist`)
      await ensureStarted()
      const snapshot = await waitForSettled(id)
      if (snapshot.status === 'error') throw snapshot.error
      if (snapshot.status !== 'ready') throw new Error(`Data node ${id} is ${snapshot.status}`)
      return snapshot.value
    },
    setState: (id, value) => scheduleStateBatch({ [id]: value }),
    setStates: scheduleStateBatch,
    setStatePath: (id, path, value) => scheduleStatePathBatch([{ id, path, value }]),
    setStatePaths: scheduleStatePathBatch,
    publish: publishResult,
    invalidate: invalidateNodes,
    refetch: refetchNodes,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      disposed = true
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      listeners.clear()
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectRefIssues(value: unknown, path: string, issues: DataGraphIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRefIssues(item, `${path}.${index}`, issues))
    return
  }
  if (!isRecord(value)) return
  if ('$data' in value && !isDataRef(value)) {
    issues.push({ code: 'invalid-ref', path, message: 'data reference must contain a string $data and optional string path only' })
    return
  }
  for (const [key, item] of Object.entries(value)) collectRefIssues(item, `${path}.${key}`, issues)
}
