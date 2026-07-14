import { getValueAtPath } from './path'
import type { DataBinding, DataRef, Resource } from './types'

export type { DataRef } from './types'

export interface StateDataNode {
  kind: 'state'
  initialValue?: unknown
  lifecycle?: 'ephemeral' | 'page' | 'session' | 'persistent'
}

export interface ResolveDataNode {
  kind: 'resolve'
  binding: DataBinding
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

export interface DataSnapshot<T = unknown> {
  status: DataStatus
  value?: T
  error?: unknown
  version: number
  updatedAt?: number
  epoch: number
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

export interface DataflowRuntime {
  start(): Promise<void>
  read(id: string): Promise<DataSnapshot | undefined>
  resolve(id: string): Promise<unknown>
  setState(id: string, value: unknown): Promise<void>
  setStates(values: Record<string, unknown>): Promise<void>
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
  let pendingWrites = new Map<string, unknown>()
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

  const waitForSettled = async (id: string): Promise<DataSnapshot> => {
    const current = await store.read(id)
    if (current && current.status !== 'pending' && current.status !== 'idle') return current
    return new Promise((resolve) => {
      const unsubscribe = store.subscribe(id, () => {
        void Promise.resolve(store.read(id)).then((snapshot) => {
          if (!snapshot || snapshot.status === 'pending' || snapshot.status === 'idle') return
          unsubscribe()
          resolve(snapshot)
        })
      })
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
          if (generation !== generations.get(id)) throw new ObsoleteExecutionError()

          const binding = resolveDataRefs(node.binding, upstream) as DataBinding
          controller = new AbortController()
          controllers.set(id, controller)
          const value = await options.resolve(binding, { signal: controller.signal, nodeId: id, epoch: batchEpoch })
          if (generation !== generations.get(id) || controller.signal.aborted) throw new ObsoleteExecutionError()
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

  const applyStateBatch = async (values: Map<string, unknown>) => {
    if (disposed) throw new Error('Dataflow runtime is disposed')
    await ensureInitialized()
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

  const scheduleStateBatch = (values: Record<string, unknown>): Promise<void> => {
    for (const [id, value] of Object.entries(values)) pendingWrites.set(id, value)
    if (!scheduledWrite) {
      scheduledWrite = Promise.resolve().then(() => {
        const batch = pendingWrites
        pendingWrites = new Map()
        scheduledWrite = undefined
        return applyStateBatch(batch)
      })
    }
    return scheduledWrite
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
