import { createElement, Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { isDataflowRef, scanDataflowRefs } from '../dataflow/ref'
import { createObjectStateEngine, isObjectStateRef, scanObjectStateRefs } from '../runtime/objectState'
import type { ObjectStateEngine } from '../runtime/objectState'
import { createCoordinatorResolve } from '../dataflow/coordinator'
import type { QueryCoordinator } from '../dataflow/coordinator'
import { createDataflowEngine } from '../dataflow/engine'
import type { DataflowEngine } from '../dataflow/engine'
import type { ConfirmSpec, DataBinding, DataflowRef, DataflowUnit, EventPolicy, KindManifest, ObjectStateDeclaration, ObjectStateRef, Resource, VariableDeclaration, VariableValue, VisibilityCondition } from '../core/types'
import type { ResourceRegistry, ScopedRegistry } from '../core/registry'
import { createVariableEngine, interpolate, scanVariableRefs } from '../runtime/variables'
import type { VariableEngine } from '../runtime/variables'
import { createMemoryRuntimeStore, runtimeKeys } from '../runtime/store'
import type { RuntimeStore } from '../runtime/store'
import { coerceVariableValue, getValueAtPath } from '../core/path'
import { canonicalStringify } from '../core/canonical'
import { runSubmit } from '../runtime/submit'
import type { HostActionRequest, KindRenderFn, RenderContext } from './types'

export interface ResourceRendererProps {
  resource: Resource
  registry: ResourceRegistry<KindRenderFn> | ScopedRegistry<KindRenderFn>
  /** Common scoped/namespaced KV snapshot/watch plane for document-visible state and extensions. */
  runtimeStore?: RuntimeStore
  /** Required with a shared runtimeStore unless the root resource has metadata.name. */
  runtimeScope?: string
  /** Opaque host-owned action boundary. ResourceKit validates scope but never interprets or executes the action. */
  onAction?: (request: HostActionRequest) => void | Promise<void>
  /** Rendered for unregistered (or not-yet-loaded) kinds. Defaults to null. */
  renderUnknownKind?: (resource: Resource) => ReactNode
  renderLoading?: () => ReactNode
  renderError?: (error: unknown, resource: Resource) => ReactNode
  /** Handles SubmitSpec.confirm. A confirmed submit fails closed when this is omitted. */
  confirmDialog?: (options: ConfirmSpec) => Promise<boolean>
  /**
   * External hook: receives `emit` event policies and submit `emit` effects.
   * This is how a document reaches app-owned behavior (toasts, navigation,
   * analytics) without the document knowing the app.
   */
  onEvent?: (event: string, payload?: unknown) => void
  onDataError?: (error: unknown, node: string) => void
  /** When provided, `dataflow` units route their fetch through this coordinator (caching/polling/dedup) instead of resolving once directly. Omitted preserves a plain one-shot fetch. */
  queryCoordinator?: QueryCoordinator
}

interface Runtime {
  engine: VariableEngine
  objectState: ObjectStateEngine
  dataflowEngine: DataflowEngine
  store: RuntimeStore
  scope: string
  dataCache: Map<string, { fingerprint: string; promise: Promise<Record<string, unknown>[]> }>
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
  declarations.push(...(resource.variables ?? []))

  for (const slot of resource.slots ?? []) {
    for (const child of slot.items) collectVariables(child, declarations)
  }

  return declarations
}

function collectObjectState(resource: Resource, declarations: ObjectStateDeclaration[] = []): ObjectStateDeclaration[] {
  declarations.push(...(resource.objectState ?? []))

  for (const slot of resource.slots ?? []) {
    for (const child of slot.items) collectObjectState(child, declarations)
  }

  return declarations
}

function collectDataflow(resource: Resource, units: DataflowUnit[] = []): DataflowUnit[] {
  units.push(...(resource.dataflow ?? []))

  for (const slot of resource.slots ?? []) {
    for (const child of slot.items) collectDataflow(child, units)
  }

  return units
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

function evaluateVisibility(condition: VisibilityCondition | undefined, get: (name: string) => VariableValue): boolean {
  if (!condition) return true
  if ('$and' in condition) return condition.$and.every((child) => evaluateVisibility(child, get))
  if ('$or' in condition) return condition.$or.some((child) => evaluateVisibility(child, get))
  if ('$not' in condition) return !evaluateVisibility(condition.$not, get)
  const value = get(condition.$variable)
  if (condition.equals !== undefined) return value === condition.equals
  if (condition.contains !== undefined) return Array.isArray(value) && value.includes(condition.contains)
  return Array.isArray(value) ? value.length > 0 : Boolean(value)
}

function isVisible(resource: Resource, runtime: Runtime): boolean {
  return evaluateVisibility(resource.visible, (name) => runtime.engine.get(name))
}

function resolveThroughRuntime(
  registry: ResourceRendererProps['registry'],
  runtime: Runtime,
  binding: DataBinding | DataflowRef | ObjectStateRef,
): Promise<Record<string, unknown>[]> {
  if (isDataflowRef(binding)) {
    const value = runtime.dataflowEngine.read(binding.$dataflow)
    return Promise.resolve(asRuntimeRows(binding.path ? getValueAtPath(value, binding.path) : value))
  }
  if (isObjectStateRef(binding)) {
    const value = runtime.objectState.get(binding.$state)
    return Promise.resolve(asRuntimeRows(binding.path ? getValueAtPath(value, binding.path) : value))
  }
  const refs = scanVariableRefs(binding)
  const bindingKey = canonicalStringify(binding)
  const fingerprint = canonicalStringify(
    Object.fromEntries([...refs].sort().map((name) => [name, runtime.engine.get(name) ?? null])),
  )
  const resolved = interpolate(binding, runtime.engine.snapshot())
  if (resolved.unresolved.size > 0) return emptyRows
  const cached = runtime.dataCache.get(bindingKey)
  if (cached?.fingerprint === fingerprint) return cached.promise
  const resolvedBinding = resolved.value as DataBinding
  const manifest = registry.getDataSourceManifest(resolvedBinding.apiVersion, resolvedBinding.kind)
  if (!manifest) return Promise.reject(new Error(`data source manifest ${resolvedBinding.apiVersion}/${resolvedBinding.kind} is not registered`))
  const promise = manifest.resolve(resolvedBinding, { variables: runtime.engine.snapshot() }).then((rows) => applyValuePath(rows, resolvedBinding))
  runtime.dataCache.set(bindingKey, { fingerprint, promise })
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

/** Looks up and invokes the `DataSourceManifest.resolve` registered for a binding's kind — the row-fetching step shared by both the direct and coordinator-routed resolve paths. */
function callResolver(
  registry: ResourceRegistry<KindRenderFn> | ScopedRegistry<KindRenderFn>,
  binding: DataBinding,
  ctx: { variables: Record<string, VariableValue>; signal?: AbortSignal },
): Promise<Record<string, unknown>[]> {
  const manifest = registry.getDataSourceManifest(binding.apiVersion, binding.kind)
  if (!manifest) throw new Error(`data source manifest ${binding.apiVersion}/${binding.kind} is not registered`)
  return manifest.resolve(binding, ctx)
}

function eventPolicy(resource: Resource, manifestPolicy: EventPolicy | undefined, event: string): EventPolicy | undefined {
  if (manifestPolicy) return manifestPolicy
  return resource.events?.[event]
}

function scanResourceObjectStateNames(resource: Resource): Set<string> {
  const names = new Set<string>()
  if (resource.bindings) for (const ref of scanObjectStateRefs(resource.bindings)) names.add(ref.$state)
  if (resource.record) for (const ref of scanObjectStateRefs(resource.record)) names.add(ref.$state)
  return names
}

function scanResourceDataflowNames(resource: Resource): Set<string> {
  const names = new Set<string>()
  for (const ref of scanDataflowRefs(resource.spec)) names.add(ref.$dataflow)
  return names
}

function scanResourceVariableNames(resource: Resource): Set<string> {
  const refs = scanVariableRefs({
    spec: resource.spec,
    bindings: resource.bindings,
    visible: resource.visible,
    disabled: resource.disabled,
    record: resource.record,
  })
  for (const slot of resource.slots ?? []) {
    for (const child of slot.items) {
      for (const name of scanVariableRefs(child.visible)) refs.add(name)
    }
  }
  return refs
}

function useNodeVersion(runtime: Runtime, resource: Resource): number {
  const objectStateDependencies = useMemo(() => scanResourceObjectStateNames(resource), [resource])
  const dataflowDependencies = useMemo(() => scanResourceDataflowNames(resource), [resource])
  const variableDependencies = useMemo(() => scanResourceVariableNames(resource), [resource])
  const versionRef = useRef(0)

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const notify = () => {
        versionRef.current++
        onStoreChange()
      }
      const unsubscribers = [
        ...[...objectStateDependencies].map((name) =>
          runtime.store.subscribe({ kind: 'key', key: runtimeKeys.objectState(name, runtime.scope) }, ({ snapshot }) => {
            if (snapshot?.status !== 'pending') notify()
          }),
        ),
        // Load-bearing, not decorative: a dataflow unit's new value is read
        // via `ctx.data.resolve`, but a consuming kind's own effect (e.g.
        // views/plugin.tsx's `useRows`) is keyed on `ctx.data.revision`,
        // which only this subscription bumps. Without it, the unit's store
        // publish alone would not re-trigger that effect.
        ...[...dataflowDependencies].map((name) =>
          runtime.store.subscribe({ kind: 'key', key: runtimeKeys.dataflow(name, runtime.scope) }, ({ snapshot }) => {
            if (snapshot?.status !== 'pending') notify()
          }),
        ),
        ...[...variableDependencies].map((name) =>
          runtime.store.subscribe({ kind: 'key', key: runtimeKeys.variable(name, runtime.scope) }, notify),
        ),
      ]
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe()
      }
    },
    [runtime.store, runtime.scope, objectStateDependencies, dataflowDependencies, variableDependencies],
  )
  const getSnapshot = useCallback(() => versionRef.current, [])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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
  nodeVersion: number,
): ReactNode {
  const { resource, registry, runtime, record } = props

  try {
    const slots = resource.slots ?? []
    const slotNodes = new Map<string | undefined, ReactNode>()
    const slotEntries = new Map<string | undefined, Array<{ resource: Resource; node: ReactNode }>>()
    const slotResources = new Map<string | undefined, Resource[]>()
    for (const [index, slot] of slots.entries()) {
      const visibleItems = slot.items.filter((child) => isVisible(child, runtime))
      const nodes = renderNodes(visibleItems, props, `slot-${index}-${slot.name ?? 'default'}`)
      slotNodes.set(slot.name, nodes)
      slotResources.set(slot.name, visibleItems)
      slotEntries.set(
        slot.name,
        visibleItems.map((child, childIndex) => ({
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
        resources: (name: string) => slotResources.get(name) ?? [],
        entries: (name?: string) => slotEntries.get(name) ?? [],
      },
      data: {
        resolve: (binding) => resolveThroughRuntime(registry, runtime, binding),
        revision: nodeVersion,
      },
      bindings: {
        has: (name) => resource.bindings?.[name] !== undefined,
        read: (name) => {
          const binding = resource.bindings?.[name]
          if (!binding) return Promise.resolve(undefined)
          if (isObjectStateRef(binding)) {
            const value = runtime.objectState.get(binding.$state)
            return Promise.resolve(binding.path ? getValueAtPath(value, binding.path) : value)
          }
          return Promise.resolve(runtime.engine.get(binding.$variable))
        },
        write: (name, value) => {
          const port = manifest.bindingPolicy?.inputs[name]
          if (!port?.writable) return Promise.reject(new Error(`Binding ${name} on kind ${resource.kind} is not writable`))
          const binding = resource.bindings?.[name]
          if (!binding) return Promise.reject(new Error(`Binding ${name} is not connected`))
          if (isObjectStateRef(binding)) {
            if (binding.path) runtime.objectState.setPath(binding.$state, binding.path, value)
            else runtime.objectState.set(binding.$state, value)
            return Promise.resolve()
          }
          runtime.engine.set(binding.$variable, coerceVariableValue(value))
          return Promise.resolve()
        },
        revision: nodeVersion,
      },
      events: {
        emit: (event: string, payload?: unknown) => {
          const policy = eventPolicy(resource, manifest.behaviorPolicy?.events?.[event], event)
          if (policy?.kind === 'setVariable') {
            runtime.engine.set(policy.variable, coerceVariableValue(getValueAtPath(payload, policy.from)))
          }
          if (policy?.kind === 'action') {
            if (allowedActions && !allowedActions.includes(policy.action)) {
              props.onDataError?.(new Error(`action ${policy.action} is not allowed in this scope`), policy.action)
            } else if (!props.onAction) {
              props.onDataError?.(new Error(`action ${policy.action} has no host handler`), policy.action)
            } else {
              void Promise.resolve()
                .then(() => props.onAction!({ action: policy.action, scope: runtime.scope, resource, payload }))
                .catch((error: unknown) => props.onDataError?.(error, policy.action))
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
      disabled: resource.disabled !== undefined && evaluateVisibility(resource.disabled, (name) => runtime.engine.get(name)),
      actions: {
        submit: (submit, payload) =>
          runSubmit(
            {
              scope: runtime.scope,
              getMutationSourceManifest: (apiVersion, kind) => registry.getMutationSourceManifest(apiVersion, kind),
              variables: {
                snapshot: () => runtime.engine.snapshot(),
                set: runtime.engine.set,
              },
              store: runtime.store,
              dataflow: {
                invalidate: runtime.dataflowEngine.invalidate,
                refetch: runtime.dataflowEngine.refetch,
              },
              allowedActions,
              confirm: props.confirmDialog,
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
  /** This resource's own data-change counter — see `useNodeVersion`. */
  nodeVersion: number
}

/**
 * Resolves `record` to a single record (first row) before rendering the
 * kind, and publishes it to descendants as the nearest record scope.
 * Re-resolves when a `${var}` referenced by the binding changes; while a
 * required variable is unresolved, renders without a record (readiness).
 */
function RecordScopeNode(props: RecordScopeNodeProps): ReactNode {
  const { resource, registry, runtime, manifest, render } = props
  const binding = resource.record

  const bindingKey = JSON.stringify(binding ?? null)
  const refs = useMemo(() => scanVariableRefs(binding), [bindingKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const fingerprint = [...refs].map((name) => JSON.stringify(runtime.engine.get(name) ?? null)).join('|')
  // props.nodeVersion (already scoped to this resource's own object-state/
  // scope dependencies by useNodeVersion) must factor into staleness too —
  // a binding that's a pure $state ref with no ${var} refs has a
  // permanently constant bindingKey/fingerprint, so without this the record
  // would never refetch when the object-state slot it reads changes.
  const stateKey = `${bindingKey}::${fingerprint}::${props.nodeVersion}`
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

  if (!binding || unresolved) return renderKindNode({ ...props, record: undefined }, manifest, render, props.nodeVersion)
  if (error) return props.renderError?.(error, resource) ?? null

  // Stale-while-revalidate: after the first load, keep rendering the previous
  // record while a refetch is in flight so children (e.g. forms) don't unmount.
  if (!state) return props.renderLoading?.() ?? null

  return renderKindNode({ ...props, record: state.record }, manifest, render, props.nodeVersion)
}

function ResourceNode(props: ResourceNodeProps): ReactNode {
  const { resource, registry } = props
  const nodeVersion = useNodeVersion(props.runtime, resource)
  useRegistryVersion(registry)

  const manifest = registry.getKind(resource.apiVersion, resource.kind)
  const render = useLoadedRender(manifest?.render, manifest?.load)
  if (!manifest) return props.renderUnknownKind?.(resource) ?? null
  if (!render) return props.renderLoading?.() ?? null

  if (manifest.recordScope) {
    return createElement(RecordScopeNode, { ...props, manifest, render, nodeVersion })
  }

  return renderKindNode(props, manifest, render, nodeVersion)
}

function RootResourceNode(props: ResourceNodeProps): ReactNode {
  useNodeVersion(props.runtime, props.resource)
  if (!isVisible(props.resource, props.runtime)) return null
  return createElement(ResourceNode, props)
}

/**
 * Recursive renderer — slots render before the kind renderer runs, so a kind
 * receives finished ReactNodes through ctx.slots and maps them onto its
 * component props.
 */
export function ResourceRenderer(props: ResourceRendererProps): ReactNode {
  const resource = props.resource
  const onDataErrorRef = useRef(props.onDataError)
  onDataErrorRef.current = props.onDataError
  const runtime = useMemo<Runtime>(() => {
    const scope = props.runtimeScope ?? resource.metadata?.name
    if (props.runtimeStore && !scope) {
      throw new Error('ResourceRenderer requires runtimeScope or root metadata.name when runtimeStore is shared')
    }
    const runtimeScope = scope ?? 'document'
    const store = props.runtimeStore ?? createMemoryRuntimeStore()
    const engine = createVariableEngine(store, runtimeScope)
    engine.declare(collectVariables(resource))
    const objectState = createObjectStateEngine(store, runtimeScope)
    objectState.declare(collectObjectState(resource))
    const dataCache = new Map<string, { fingerprint: string; promise: Promise<Record<string, unknown>[]> }>()

    const coordinatorResolve = props.queryCoordinator
      ? createCoordinatorResolve({
          coordinator: props.queryCoordinator,
          registry: props.registry,
          resolve: async (b, ctx) => applyValuePath(await callResolver(props.registry, b, ctx), b),
          scopePolicy: 'options' in props.registry ? props.registry.options.queryPolicy : undefined,
          // The only path a coordinator's own background activity (a poll
          // tick, an out-of-band invalidate/refetch) reaches the engine —
          // `resolve()` itself only ever delivers the *first* value for a
          // given call. Publishing into the `dataflow` namespace is what the
          // engine reads directly off on every subsequent `read()`/`status()`.
          onUpdate: (nodeId, snapshot) => {
            const key = runtimeKeys.dataflow(nodeId, runtimeScope)
            if (snapshot.status === 'ready') store.publish(key, { status: 'ready', value: snapshot.value })
            else if (snapshot.status === 'error') store.publish(key, { status: 'error', error: snapshot.error })
          },
        })
      : undefined

    const dataflowEngine = createDataflowEngine({
      store,
      scope: runtimeScope,
      variables: engine,
      resolve: async (b, ctx) => applyValuePath(await callResolver(props.registry, b, ctx), b),
      coordinatorResolve,
      scopePolicy: 'options' in props.registry ? props.registry.options.queryPolicy : undefined,
    })

    return { engine, objectState, dataflowEngine, store, scope: runtimeScope, dataCache }
  }, [props.runtimeStore, props.runtimeScope, props.registry, props.queryCoordinator, resource])

  useEffect(() => {
    runtime.dataflowEngine.declare(collectDataflow(resource))
    return () => runtime.dataflowEngine.dispose()
  }, [runtime, resource])

  return createElement(RootResourceNode, { ...props, resource, runtime })
}
