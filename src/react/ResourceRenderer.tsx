import { createElement, Fragment, useEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { DataBinding, EventPolicy, KindManifest, Resource, VariableDeclaration } from '../types'
import type { ResourceRegistry, ScopedRegistry } from '../registry'
import { createVariableEngine, interpolate, scanVariableRefs } from '../variables'
import type { VariableEngine } from '../variables'
import { coerceVariableValue, getValueAtPath } from '../path'
import { runSubmit } from '../submit'
import type { KindRenderFn, RenderContext } from './types'

export interface ResourceRendererProps {
  resource: Resource
  registry: ResourceRegistry<KindRenderFn> | ScopedRegistry<KindRenderFn>
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
}

interface Runtime {
  engine: VariableEngine
  dataCache: Map<string, Promise<Record<string, unknown>[]>>
  bindingRefs: Map<string, Set<string>>
  subscribeVersion: (listener: () => void) => () => void
  getVersion: () => number
}

interface ResourceNodeProps extends ResourceRendererProps {
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
  binding: DataBinding,
): Promise<Record<string, unknown>[]> {
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
  const [loaded, setLoaded] = useState<KindRenderFn | undefined>(() => manifestRender)
  const [error, setError] = useState<unknown>()

  if (error) throw error

  useEffect(() => {
    let active = true
    if (manifestRender) {
      setLoaded(() => manifestRender)
      return
    }
    if (!load) {
      setLoaded(undefined)
      return
    }
    setLoaded(undefined)
    load()
      .then((render) => {
        if (active) setLoaded(() => render)
      })
      .catch((nextError: unknown) => {
        if (active) setError(nextError)
      })
    return () => {
      active = false
    }
  }, [load, manifestRender])

  return loaded
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
        resolve: (binding: DataBinding) => resolveThroughRuntime(registry, runtime, binding),
      },
      events: {
        emit: (event: string, payload?: unknown) => {
          const policy = eventPolicy(resource, manifest.behaviorPolicy?.events?.[event], event)
          if (policy?.kind === 'setVariable') {
            runtime.engine.set(policy.variable, coerceVariableValue(getValueAtPath(payload, policy.from)))
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
  const runtime = useMemo<Runtime>(() => {
    const engine = createVariableEngine()
    engine.declare(collectVariables(props.resource))
    const dataCache = new Map<string, Promise<Record<string, unknown>[]>>()
    const bindingRefs = new Map<string, Set<string>>()
    const listeners = new Set<() => void>()
    let version = 0

    const subscribeVersion = (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    engine.subscribe((changed) => {
      for (const [key, refs] of bindingRefs.entries()) {
        if ([...changed].some((name) => refs.has(name))) dataCache.delete(key)
      }
      version++
      for (const listener of listeners) listener()
    })

    return { engine, dataCache, bindingRefs, subscribeVersion, getVersion: () => version }
  }, [props.resource])

  return createElement(ResourceNode, { ...props, runtime })
}
