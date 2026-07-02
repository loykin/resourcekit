import type { ReactNode } from 'react'
import type { DataBinding, LoykinResource } from '../types'

/**
 * React narrowing of the manifest's generic `render` member.
 * Kinds receive their resource plus a runtime context — they never touch
 * sibling resources, parent specs, or data kits directly.
 */
export type KindRenderFn<TSpec = unknown> = (
  resource: LoykinResource<TSpec>,
  ctx: RenderContext,
) => ReactNode

export interface RenderContext {
  slots: SlotAccessor
  data: {
    /** Interpolates the binding and dispatches it to the registered resolver. */
    resolve: (binding: DataBinding) => Promise<Record<string, unknown>[]>
  }
  events: {
    /** Routes through the kind's behavior policy (emit / action / setVariable). */
    emit: (event: string, payload?: unknown) => void
  }
  variables: {
    get: (name: string) => string | string[] | undefined
    set: (name: string, value: string | string[] | undefined) => void
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
  resources(name: string): LoykinResource[]
}
