import type { ReactNode } from 'react'
import type { DataRef } from '../types'
import type { DataBinding, Resource, SubmitSpec } from '../types'
import type { SubmitResult } from '../submit'

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
    /** Interpolates the binding and dispatches it to the registered resolver. */
    resolve: (binding: DataBinding | DataRef) => Promise<Record<string, unknown>[]>
    /** Reads a data node without coercing its value into rows. */
    read: (ref: DataRef) => Promise<unknown>
    /** Writes a document-scoped state node. Rejects when no graph or writable node exists. */
    set: (node: string, value: unknown) => Promise<void>
    /** Changes when a document data snapshot settles; adapters use it to refresh DataRef consumers. */
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
