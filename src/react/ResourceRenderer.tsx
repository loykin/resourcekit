import { createElement, Fragment, useEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { DataBinding, EventPolicy, LoykinResource, VariableDeclaration, VariableValue } from '../types'
import type { ResourceRegistry, ScopedRegistry } from '../registry'
import { createVariableEngine, interpolate, scanVariableRefs } from '../variables'
import type { VariableEngine } from '../variables'
import type { KindRenderFn } from './types'

export interface ResourceRendererProps {
  resource: LoykinResource
  registry: ResourceRegistry<KindRenderFn> | ScopedRegistry<KindRenderFn>
  /** Rendered for unregistered (or not-yet-loaded) kinds. Defaults to null. */
  renderUnknownKind?: (resource: LoykinResource) => ReactNode
  renderLoading?: () => ReactNode
  renderError?: (error: unknown, resource: LoykinResource) => ReactNode
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
}

const emptyRows = Promise.resolve<Record<string, unknown>[]>([])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectVariables(resource: LoykinResource, declarations: VariableDeclaration[] = []): VariableDeclaration[] {
  if (isRecord(resource.spec) && Array.isArray(resource.spec.variables)) {
    for (const item of resource.spec.variables) {
      if (isRecord(item) && typeof item.name === 'string') declarations.push(item as unknown as VariableDeclaration)
    }
  }

  for (const slot of resource.slots ?? []) {
    for (const child of slot.children) collectVariables(child, declarations)
  }

  return declarations
}

function renderNodes(
  resources: LoykinResource[],
  props: ResourceRendererProps,
  runtime: Runtime,
  keyPrefix: string,
): ReactNode {
  return resources.map((resource, index) =>
    createElement(ResourceNode, {
      ...props,
      key: `${keyPrefix}-${index}-${resource.apiVersion}-${resource.kind}-${resource.metadata?.name ?? ''}`,
      resource,
      runtime,
    }),
  )
}

function getPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value
  return path.split('.').reduce<unknown>((current, part) => {
    if (!isRecord(current)) return undefined
    return current[part]
  }, value)
}

function coerceVariableValue(value: unknown): VariableValue {
  if (typeof value === 'string' || value === undefined) return value
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value
  if (value === null) return undefined
  return String(value)
}

function eventPolicy(resource: LoykinResource, manifestPolicy: EventPolicy | undefined, event: string): EventPolicy | undefined {
  if (manifestPolicy) return manifestPolicy
  if (!isRecord(resource.spec) || !isRecord(resource.spec.events)) return undefined
  const policy = resource.spec.events[event]
  return isRecord(policy) && typeof policy.kind === 'string' ? (policy as unknown as EventPolicy) : undefined
}

function useRenderVersion(runtime: Runtime): void {
  useSyncExternalStore(runtime.subscribeVersion, runtime.getVersion, runtime.getVersion)
}

function useRegistryVersion(registry: ResourceRegistry<KindRenderFn> | ScopedRegistry<KindRenderFn>): void {
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

function ResourceNode(props: ResourceNodeProps): ReactNode {
  const { resource, registry, runtime, renderUnknownKind, renderLoading, renderError } = props
  useRenderVersion(runtime)
  useRegistryVersion(registry)

  const manifest = registry.getKind(resource.apiVersion, resource.kind)
  const render = useLoadedRender(manifest?.render, manifest?.load)
  if (!manifest) return renderUnknownKind?.(resource) ?? null
  if (!render) return renderLoading?.() ?? null

  try {
    const slots = resource.slots ?? []
    const slotNodes = new Map<string | undefined, ReactNode>()
    for (const [index, slot] of slots.entries()) {
      slotNodes.set(slot.name, renderNodes(slot.children, props, runtime, `slot-${index}-${slot.name ?? 'default'}`))
    }

    const ctx = {
      slots: {
        children: () => slotNodes.get(undefined) ?? null,
        one: (name: string) => slotNodes.get(name) ?? null,
        requiredOne: (name: string) => {
          const node = slotNodes.get(name)
          if (node === undefined || node === null) throw new Error(`required slot ${name} is missing`)
          return node
        },
        resources: (name: string) => slots.find((slot) => slot.name === name)?.children ?? [],
      },
      data: {
        resolve: (binding: DataBinding) => {
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
          const promise = resolver(resolvedBinding, { variables: runtime.engine.snapshot() })
          runtime.dataCache.set(key, promise)
          return promise
        },
      },
      events: {
        emit: (event: string, payload?: unknown) => {
          const policy = eventPolicy(resource, manifest.behaviorPolicy?.events?.[event], event)
          if (policy?.kind === 'setVariable') {
            runtime.engine.set(policy.variable, coerceVariableValue(getPath(payload, policy.from)))
          }
        },
      },
      variables: {
        get: runtime.engine.get,
        set: runtime.engine.set,
      },
    }

    return createElement(Fragment, null, render(resource, ctx))
  } catch (error) {
    return renderError?.(error, resource) ?? null
  }
}

/**
 * Recursive renderer — slots render before the kind renderer runs, so a kind
 * receives finished ReactNodes through ctx.slots and maps them onto its
 * component props.
 *
 * Responsibilities (phase 1, see Development Plan in the spec doc):
 * - kind lookup + unknown-kind fallback (degrade the node, not the document)
 * - lazy `load()` render support
 * - variable subscription → re-resolve only bindings that reference changed vars
 * - readiness: bindings with unresolved required variables do not execute
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
