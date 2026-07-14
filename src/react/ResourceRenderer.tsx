import { createElement, Fragment, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createDataflowRuntime, isDataRef } from '../dataflow'
import type { DataflowRuntime, DataRef, DataStore, ResourceDocument } from '../dataflow'
import type { DataBinding, EventPolicy, KindManifest, Resource, VariableDeclaration } from '../types'
import type { ResourceRegistry, ScopedRegistry } from '../registry'
import { createVariableEngine, interpolate, scanVariableRefs } from '../variables'
import type { VariableEngine } from '../variables'
import { coerceVariableValue, getValueAtPath } from '../path'
import { runSubmit } from '../submit'
import type { KindRenderFn, RenderContext } from './types'

export interface ResourceRendererProps {
  resource: Resource | ResourceDocument
  registry: ResourceRegistry<KindRenderFn> | ScopedRegistry<KindRenderFn>
  /** Optional physical store for an experimental ResourceDocument data graph. */
  dataStore?: DataStore
  /** Rendered for unregistered (or not-yet-loaded) kinds. Defaults to null. */
  renderUnknownKind?: (resource: Resource) => ReactNode
  renderLoading?: () => ReactNode
  renderError?: (error: unknown, resource: Resource) => ReactNode
  /**
   * External hook: receives `emit` event policies and submit `emit` effects.
   * This is how a document reaches app-owned behavior (toasts, navigation,
   * analytics) without the document knowing the app.
   */
  onEvent?: (event: string, payload?: unknown) => void
  onDataError?: (error: unknown, node: string) => void
}

interface Runtime {
  engine: VariableEngine
  dataCache: Map<string, Promise<Record<string, unknown>[]>>
  bindingRefs: Map<string, Set<string>>
  dataflow?: DataflowRuntime
  subscribeVersion: (listener: () => void) => () => void
  getVersion: () => number
}

interface ResourceNodeProps extends Omit<ResourceRendererProps, 'resource'> {
  resource: Resource
  runtime: Runtime
  /** Nearest ancestor record scope, inherited by all descendants. */
  record?: Record<string, unknown>
}

const emptyRows = Promise.resolve<Record<string, unknown>[]>([])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectVariables(resource: Resource, declarations: VariableDeclaration[] = []): VariableDeclaration[] {
  if (isRecord(resource.spec) && Array.isArray(resource.spec.variables)) {
    for (const item of resource.spec.variables) {
      if (isRecord(item) && typeof item.name === 'string') declarations.push(item as unknown as VariableDeclaration)
    }
  }

  for (const slot of resource.slots ?? []) {
    for (const child of slot.items) collectVariables(child, declarations)
  }

  return declarations
}

function renderNodes(
  resources: Resource[],
  props: ResourceNodeProps,
  keyPrefix: string,
): ReactNode {
  return resources.map((resource, index) =>
    createElement(ResourceNode, {
      ...props,
      key: `${keyPrefix}-${index}-${resource.apiVersion}-${resource.kind}-${resource.metadata?.name ?? ''}`,
      resource,
    }),
  )
}

function resolveThroughRuntime(
  registry: ResourceRendererProps['registry'],
  runtime: Runtime,
  binding: DataBinding | DataRef,
): Promise<Record<string, unknown>[]> {
  if (isDataRef(binding)) {
    if (!runtime.dataflow) return Promise.reject(new Error(`Data reference ${binding.$data} requires a ResourceDocument data graph`))
    return runtime.dataflow.resolve(binding.$data).then((value) => asRuntimeRows(binding.path ? getValueAtPath(value, binding.path) : value))
  }
  const refs = scanVariableRefs(binding)
  const key = JSON.stringify(binding)
  runtime.bindingRefs.set(key, refs)
  const resolved = interpolate(binding, runtime.engine.snapshot())
  if (resolved.unresolved.size > 0) return emptyRows
  const cached = runtime.dataCache.get(key)
  if (cached) return cached
  const resolvedBinding = resolved.value as DataBinding
  const resolver = registry.getDataResolver(resolvedBinding.source)
  if (!resolver) return Promise.reject(new Error(`data resolver ${resolvedBinding.source} is not registered`))
  const promise = resolver(resolvedBinding, { variables: runtime.engine.snapshot() }).then((rows) => applyValuePath(rows, resolvedBinding))
  runtime.dataCache.set(key, promise)
  return promise
}

function asRuntimeRows(value: unknown): Record<string, unknown>[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    if (!value.every((item) => isRecord(item))) throw new Error('Data reference expected an array of objects')
    return value
  }
  if (isRecord(value)) return [value]
  return [{ value }]
}

function applyValuePath(rows: Record<string, unknown>[], binding: DataBinding): Record<string, unknown>[] {
  const valuePath = typeof binding.valuePath === 'string' ? binding.valuePath : undefined
  if (!valuePath) return rows
  return rows.flatMap((row) => {
    const value = getValueAtPath(row, valuePath)
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => isRecord(item))
    }
    if (isRecord(value)) return [value]
    return [{ value }]
  })
}

function eventPolicy(resource: Resource, manifestPolicy: EventPolicy | undefined, event: string): EventPolicy | undefined {
  if (manifestPolicy) return manifestPolicy
  if (!isRecord(resource.spec) || !isRecord(resource.spec.events)) return undefined
  const policy = resource.spec.events[event]
  return isRecord(policy) && typeof policy.kind === 'string' ? (policy as unknown as EventPolicy) : undefined
}

function useRenderVersion(runtime: Runtime): void {
  useSyncExternalStore(runtime.subscribeVersion, runtime.getVersion, runtime.getVersion)
}

function useRegistryVersion(registry: ResourceRendererProps['registry']): void {
  const [, bump] = useReducer((value: number) => value + 1, 0)
  useEffect(() => registry.subscribe(bump), [registry])
}

function useLoadedRender(manifestRender: KindRenderFn | undefined, load: (() => Promise<KindRenderFn>) | undefined): KindRenderFn | undefined {
  const [loaded, setLoaded] = useState<{ loader: () => Promise<KindRenderFn>; render: KindRenderFn }>()
  const [failure, setFailure] = useState<{ loader: () => Promise<KindRenderFn>; error: unknown }>()

  if (load && failure?.loader === load) throw failure.error

  useEffect(() => {
    let active = true
    if (manifestRender || !load) return
    load()
      .then((render) => {
        if (active) setLoaded({ loader: load, render })
      })
      .catch((nextError: unknown) => {
        if (active) setFailure({ loader: load, error: nextError })
      })
    return () => {
      active = false
    }
  }, [load, manifestRender])

  if (manifestRender) return manifestRender
  return load && loaded?.loader === load ? loaded.render : undefined
}

function renderKindNode(
  props: ResourceNodeProps,
  manifest: KindManifest<unknown, KindRenderFn>,
  render: KindRenderFn,
): ReactNode {
  const { resource, registry, runtime, record } = props

  try {
    const slots = resource.slots ?? []
    const slotNodes = new Map<string | undefined, ReactNode>()
    const slotEntries = new Map<string | undefined, Array<{ resource: Resource; node: ReactNode }>>()
    for (const [index, slot] of slots.entries()) {
      const nodes = renderNodes(slot.items, props, `slot-${index}-${slot.name ?? 'default'}`)
      slotNodes.set(slot.name, nodes)
      slotEntries.set(
        slot.name,
        slot.items.map((child, childIndex) => ({
          resource: child,
          node: Array.isArray(nodes) ? nodes[childIndex] : null,
        })),
      )
    }

    const allowedActions = 'options' in registry ? registry.options.actions?.allow : undefined

    const ctx: RenderContext = {
      slots: {
        children: () => slotNodes.get(undefined) ?? null,
        one: (name: string) => slotNodes.get(name) ?? null,
        requiredOne: (name: string) => {
          const node = slotNodes.get(name)
          if (node === undefined || node === null) throw new Error(`required slot ${name} is missing`)
          return node
        },
        resources: (name: string) => slots.find((slot) => slot.name === name)?.items ?? [],
        entries: (name?: string) => slotEntries.get(name) ?? [],
      },
      data: {
        resolve: (binding) => resolveThroughRuntime(registry, runtime, binding),
        read: (ref) => {
          if (!runtime.dataflow) return Promise.reject(new Error(`Data reference ${ref.$data} requires a ResourceDocument data graph`))
          return runtime.dataflow.resolve(ref.$data).then((value) => ref.path ? getValueAtPath(value, ref.path) : value)
        },
        set: (node, value) => {
          if (!runtime.dataflow) return Promise.reject(new Error(`Data node ${node} requires a ResourceDocument data graph`))
          return runtime.dataflow.setState(node, value)
        },
        revision: runtime.getVersion(),
      },
      bindings: {
        has: (name) => resource.bindings?.[name] !== undefined,
        read: (name) => {
          const binding = resource.bindings?.[name]
          if (!binding) return Promise.resolve(undefined)
          if (isDataRef(binding)) {
            if (!runtime.dataflow) return Promise.reject(new Error(`Data reference ${binding.$data} requires a ResourceDocument data graph`))
            return runtime.dataflow.resolve(binding.$data).then((value) => binding.path ? getValueAtPath(value, binding.path) : value)
          }
          return Promise.resolve(runtime.engine.get(binding.$variable))
        },
        write: (name, value) => {
          const port = manifest.bindingPolicy?.inputs[name]
          if (!port?.writable) return Promise.reject(new Error(`Binding ${name} on kind ${resource.kind} is not writable`))
          const binding = resource.bindings?.[name]
          if (!binding) return Promise.reject(new Error(`Binding ${name} is not connected`))
          if (isDataRef(binding)) {
            if (!runtime.dataflow) return Promise.reject(new Error(`Data reference ${binding.$data} requires a ResourceDocument data graph`))
            return runtime.dataflow.setState(binding.$data, value)
          }
          runtime.engine.set(binding.$variable, coerceVariableValue(value))
          return Promise.resolve()
        },
        revision: runtime.getVersion(),
      },
      events: {
        emit: (event: string, payload?: unknown) => {
          const policy = eventPolicy(resource, manifest.behaviorPolicy?.events?.[event], event)
          if (policy?.kind === 'setVariable') {
            runtime.engine.set(policy.variable, coerceVariableValue(getValueAtPath(payload, policy.from)))
          }
          if (policy?.kind === 'setData') {
            if (!runtime.dataflow) {
              props.onDataError?.(new Error(`Data node ${policy.node} requires a ResourceDocument data graph`), policy.node)
            } else {
              void runtime.dataflow
                .setState(policy.node, getValueAtPath(payload, policy.from))
                .catch((error: unknown) => props.onDataError?.(error, policy.node))
            }
          }
          if (policy?.kind === 'emit') {
            props.onEvent?.(policy.event, payload)
          }
        },
      },
      variables: {
        get: runtime.engine.get,
        set: runtime.engine.set,
      },
      record,
      actions: {
        submit: (submit, payload) =>
          runSubmit(
            {
              getMutationResolver: (target) => registry.getMutationResolver(target),
              variables: {
                snapshot: () => runtime.engine.snapshot(),
                set: (name, value) => runtime.engine.set(name, value),
              },
              allowedActions,
              emit: (event, result) => props.onEvent?.(event, result),
            },
            submit,
            payload,
          ),
      },
    }

    return createElement(Fragment, null, render(resource, ctx))
  } catch (error) {
    return props.renderError?.(error, resource) ?? null
  }
}

interface RecordScopeNodeProps extends ResourceNodeProps {
  manifest: KindManifest<unknown, KindRenderFn>
  render: KindRenderFn
}

/**
 * Resolves `spec.data` to a single record (first row) before rendering the
 * kind, and publishes it to descendants as the nearest record scope.
 * Re-resolves when a `${var}` referenced by the binding changes; while a
 * required variable is unresolved, renders without a record (readiness).
 */
function RecordScopeNode(props: RecordScopeNodeProps): ReactNode {
  const { resource, registry, runtime, manifest, render } = props
  const spec = resource.spec
  const binding = isRecord(spec) && isRecord(spec.data) ? (spec.data as DataBinding) : undefined

  const bindingKey = JSON.stringify(binding ?? null)
  const refs = useMemo(() => scanVariableRefs(binding), [bindingKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const fingerprint = [...refs].map((name) => JSON.stringify(runtime.engine.get(name) ?? null)).join('|')
  const stateKey = `${bindingKey}::${fingerprint}`
  const unresolved = binding ? interpolate(binding, runtime.engine.snapshot()).unresolved.size > 0 : false

  const [state, setState] = useState<{ key: string; record: Record<string, unknown> | undefined } | null>(null)
  const [error, setError] = useState<unknown>()

  useEffect(() => {
    if (!binding || unresolved) return
    let cancelled = false
    setError(undefined)
    resolveThroughRuntime(registry, runtime, binding)
      .then((rows) => {
        if (cancelled) return
        const record = rows[0] && isRecord(rows[0]) ? rows[0] : undefined
        setState({ key: stateKey, record })
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(nextError)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, unresolved])

  if (!binding || unresolved) return renderKindNode({ ...props, record: undefined }, manifest, render)
  if (error) return props.renderError?.(error, resource) ?? null

  // Stale-while-revalidate: after the first load, keep rendering the previous
  // record while a refetch is in flight so children (e.g. forms) don't unmount.
  if (!state) return props.renderLoading?.() ?? null

  return renderKindNode({ ...props, record: state.record }, manifest, render)
}

function ResourceNode(props: ResourceNodeProps): ReactNode {
  const { resource, registry } = props
  useRenderVersion(props.runtime)
  useRegistryVersion(registry)

  const manifest = registry.getKind(resource.apiVersion, resource.kind)
  const render = useLoadedRender(manifest?.render, manifest?.load)
  if (!manifest) return props.renderUnknownKind?.(resource) ?? null
  if (!render) return props.renderLoading?.() ?? null

  if (manifest.recordScope) {
    return createElement(RecordScopeNode, { ...props, manifest, render })
  }

  return renderKindNode(props, manifest, render)
}

/**
 * Recursive renderer — slots render before the kind renderer runs, so a kind
 * receives finished ReactNodes through ctx.slots and maps them onto its
 * component props.
 */
export function ResourceRenderer(props: ResourceRendererProps): ReactNode {
  const document = isResourceDocument(props.resource) ? props.resource : undefined
  const resource: Resource = document ? document.resource : props.resource as Resource
  const onDataError = props.onDataError
  const dataflowUses = useRef(new WeakMap<DataflowRuntime, { count: number }>())
  const runtime = useMemo<Runtime>(() => {
    const engine = createVariableEngine()
    engine.declare(collectVariables(resource))
    const dataCache = new Map<string, Promise<Record<string, unknown>[]>>()
    const bindingRefs = new Map<string, Set<string>>()
    const listeners = new Set<() => void>()
    let version = 0

    const subscribeVersion = (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    const notify = () => {
      version++
      for (const listener of listeners) listener()
    }

    engine.subscribe((changed) => {
      for (const [key, refs] of bindingRefs.entries()) {
        if ([...changed].some((name) => refs.has(name))) dataCache.delete(key)
      }
      notify()
    })

    const dataflow = document?.data
      ? createDataflowRuntime({
          graph: document.data,
          store: props.dataStore,
          resolve: async (binding, context) => {
            const resolved = interpolate(binding, engine.snapshot())
            if (resolved.unresolved.size > 0) return []
            const resolvedBinding = resolved.value as DataBinding
            const resolver = props.registry.getDataResolver(resolvedBinding.source)
            if (!resolver) throw new Error(`data resolver ${resolvedBinding.source} is not registered`)
            const rows = await resolver(resolvedBinding, { variables: engine.snapshot(), signal: context.signal })
            return applyValuePath(rows, resolvedBinding)
          },
        })
      : undefined

    dataflow?.subscribe((_id, snapshot) => {
      if (snapshot.status !== 'pending') notify()
    })

    return { engine, dataCache, bindingRefs, dataflow, subscribeVersion, getVersion: () => version }
  }, [props.dataStore, props.registry, document, resource])

  useEffect(() => {
    const dataflow = runtime.dataflow
    if (!dataflow) return
    const usage = dataflowUses.current.get(dataflow) ?? { count: 0 }
    usage.count++
    dataflowUses.current.set(dataflow, usage)
    void dataflow.start().catch((error: unknown) => onDataError?.(error, 'dataGraph'))
    return () => {
      usage.count--
      void Promise.resolve().then(() => {
        if (usage.count === 0) dataflow.dispose()
      })
    }
  }, [onDataError, runtime])

  return createElement(ResourceNode, { ...props, resource, runtime })
}

function isResourceDocument(value: Resource | ResourceDocument): value is ResourceDocument {
  return 'resource' in value
}
