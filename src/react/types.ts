import type { ReactNode } from 'react'
import type { DataBinding, Resource, ScopeRef, SubmitSpec } from '../core/types'
import type { SubmitResult } from '../runtime/submit'

export interface HostActionRequest {
  action: string
  payload?: unknown
  resource: Resource
  scope: string
}

/**
 * React narrowing of the manifest's generic `render` member.
 * Kinds receive their resource plus a runtime context — they never touch
 * sibling resources, parent specs, or data kits directly.
 */
export type KindRenderFn<TSpec = unknown> = (
  resource: Resource<TSpec>,
  ctx: RenderContext,
) => ReactNode

export interface RenderContext {
  slots: SlotAccessor
  data: {
    /** Interpolates the binding and dispatches it to the registered resolver, or reads a named ancestor scope for a `ScopeRef`. */
    resolve: (binding: DataBinding | ScopeRef) => Promise<Record<string, unknown>[]>
    /** Changes when a referenced scope/variable settles; adapters use it to refresh `ScopeRef` consumers. */
    revision: number
  }
  bindings: {
    has: (name: string) => boolean
    read: (name: string) => Promise<unknown>
    write: (name: string, value: unknown) => Promise<void>
    revision: number
  }
  events: {
    /** Routes through the kind's behavior policy. The runtime handles emit and setVariable. */
    emit: (event: string, payload?: unknown) => void
  }
  variables: {
    get: (name: string) => string | string[] | undefined
    set: (name: string, value: string | string[] | undefined) => void
  }
  /**
   * Nearest record scope — the resolved single record of the closest
   * ancestor kind with `recordScope: true`. Kinds read fields from it with
   * dot-paths (`fieldRef`). Undefined outside any record scope.
   */
  record?: Record<string, unknown>
  /**
   * Named ancestor scopes — the raw (non-row-coerced) resolved value of
   * every enclosing `scopeProvider: true` kind, keyed by its `scope.name`.
   * Most kinds read a scope via `data.resolve({ "$scope": name })` instead
   * (row-coerced, cached); this is the direct escape hatch for a kind (or
   * test) that needs the raw value as-is.
   */
  scopes: Record<string, unknown>
  /**
   * `resource.disabled` evaluated against the page variable engine. Unlike
   * `visible`, this never gates rendering — kinds with a natural disabled
   * affordance (buttons, inputs, actions) opt into consuming it.
   */
  disabled: boolean
  actions: {
    /** Executes a declarative submit (optional confirmation + mutation binding + onSuccess effects). */
    submit: (submit: SubmitSpec, payload: unknown) => Promise<SubmitResult>
  }
}

/** Rendered slot output, resolved before the kind renderer is invoked. */
export interface SlotAccessor {
  /** Default slot children. */
  children(): ReactNode
  /** Named slot; null when empty. */
  one(name: string): ReactNode
  /** Named slot; throws a validation-level error when missing. */
  requiredOne(name: string): ReactNode
  /** Raw child resources of a named slot (for kinds that map slots to data props). */
  resources(name: string): Resource[]
  /** Child resources paired with their rendered node, preserving child boundaries. */
  entries(name?: string): Array<{ resource: Resource; node: ReactNode }>
}
