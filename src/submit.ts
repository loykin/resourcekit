import { interpolate } from './variables'
import { coerceVariableValue, getValueAtPath } from './path'
import type { ConfirmSpec, MutationBinding, MutationResolver, SubmitSpec, VariableValue } from './types'

export const SUBMIT_CANCELLED = Symbol('resourcekit.submit.cancelled')
export type SubmitResult = unknown | typeof SUBMIT_CANCELLED

export interface SubmitRuntime {
  getMutationResolver(target: string): MutationResolver | undefined
  variables: {
    snapshot(): Record<string, VariableValue>
    set(name: string, value: VariableValue): void
  }
  /** When provided, submits whose `action` is not listed are rejected. */
  allowedActions?: string[]
  /** Required when SubmitSpec.confirm is present. */
  confirm?: (options: ConfirmSpec) => Promise<boolean>
  /** Receives `emit` effects — the host app's external hook. */
  emit?: (event: string, payload: unknown) => void
  /** Present only when the document has a data graph — required by `setData`/`invalidateData`/`refetchData` effects. */
  dataflow?: {
    setState(id: string, value: unknown): Promise<void>
    invalidate(ids: string[]): Promise<void>
    refetch(ids: string[]): Promise<void>
  }
}

/**
 * Execute a declarative submit: interpolate the mutation binding, dispatch it
 * to the registered mutation resolver, then apply `onSuccess` effects.
 * Headless — the react adapter exposes this as `ctx.actions.submit`.
 */
export async function runSubmit(runtime: SubmitRuntime, submit: SubmitSpec, payload: unknown): Promise<SubmitResult> {
  if (runtime.allowedActions && submit.action !== undefined && !runtime.allowedActions.includes(submit.action)) {
    throw new Error(`action ${submit.action} is not allowed in this scope`)
  }

  const snapshot = runtime.variables.snapshot()
  const mutation = resolveSubmitValue(submit.mutation, snapshot, payload)
  const confirm = submit.confirm ? resolveSubmitValue(submit.confirm, snapshot, payload) : undefined
  const unresolved = new Set([...mutation.unresolved, ...(confirm?.unresolved ?? [])])
  if (unresolved.size > 0) {
    throw new Error(`unresolved references in submit: ${[...unresolved].join(', ')}`)
  }

  const binding = mutation.value as MutationBinding
  const resolver = runtime.getMutationResolver(binding.target)
  if (!resolver) {
    throw new Error(`mutation resolver ${binding.target} is not registered`)
  }

  if (submit.confirm && !runtime.confirm) {
    throw new Error('SubmitSpec.confirm is set but no confirm handler is wired')
  }
  if (confirm) {
    const options = confirm.value as ConfirmSpec
    if (typeof options.title !== 'string' || (options.description !== undefined && typeof options.description !== 'string')) {
      throw new Error('resolved submit confirmation must contain string title and description values')
    }
    if (!(await runtime.confirm!(options))) return SUBMIT_CANCELLED
  }

  const result = await resolver(binding, payload, { variables: snapshot })

  for (const effect of submit.onSuccess ?? []) {
    if (effect.kind === 'setVariable') {
      const next =
        effect.value !== undefined
          ? effect.value
          : effect.from !== undefined
            ? coerceVariableValue(getValueAtPath(result, effect.from))
            : undefined
      runtime.variables.set(effect.variable, next)
    }
    if (effect.kind === 'emit') {
      runtime.emit?.(effect.event, result)
    }
    if (effect.kind === 'setData') {
      if (!runtime.dataflow) throw new Error(`setData effect on node ${effect.node} requires a ResourceDocument data graph`)
      const next = effect.value !== undefined ? effect.value : effect.from !== undefined ? getValueAtPath(result, effect.from) : result
      await runtime.dataflow.setState(effect.node, next)
    }
    if (effect.kind === 'invalidateData') {
      if (!runtime.dataflow) throw new Error(`invalidateData effect requires a ResourceDocument data graph`)
      await runtime.dataflow.invalidate(effect.nodes)
    }
    if (effect.kind === 'refetchData') {
      if (!runtime.dataflow) throw new Error(`refetchData effect requires a ResourceDocument data graph`)
      await runtime.dataflow.refetch(effect.nodes)
    }
  }

  return result
}

const PAYLOAD_REF_RE = /\$\{payload\.([^}]+)}/g

function resolveSubmitValue(
  value: unknown,
  variables: Record<string, VariableValue>,
  payload: unknown,
): { value: unknown; unresolved: Set<string> } {
  const pageResolved = interpolate(value, variables)
  const unresolved = new Set(pageResolved.unresolved)

  const replaceString = (current: string): unknown => {
    const exact = current.match(/^\$\{payload\.([^}]+)}$/)
    if (exact) {
      const replacement = getValueAtPath(payload, exact[1])
      if (replacement === undefined) {
        unresolved.add(`payload.${exact[1]}`)
        return current
      }
      return replacement
    }

    return current.replace(PAYLOAD_REF_RE, (placeholder, path: string) => {
      const replacement = getValueAtPath(payload, path)
      if (replacement === undefined) {
        unresolved.add(`payload.${path}`)
        return placeholder
      }
      return Array.isArray(replacement) ? replacement.join(',') : String(replacement)
    })
  }

  const visit = (current: unknown): unknown => {
    if (typeof current === 'string') return replaceString(current)
    if (Array.isArray(current)) return current.map(visit)
    if (typeof current === 'object' && current !== null) {
      return Object.fromEntries(Object.entries(current).map(([key, item]) => [key, visit(item)]))
    }
    return current
  }

  return { value: visit(pageResolved.value), unresolved }
}
