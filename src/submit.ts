import { interpolate } from './variables'
import { coerceVariableValue, getValueAtPath } from './path'
import type { MutationBinding, MutationResolver, SubmitSpec, VariableValue } from './types'

export interface SubmitRuntime {
  getMutationResolver(target: string): MutationResolver | undefined
  variables: {
    snapshot(): Record<string, VariableValue>
    set(name: string, value: VariableValue): void
  }
  /** When provided, submits whose `action` is not listed are rejected. */
  allowedActions?: string[]
  /** Receives `emit` effects — the host app's external hook. */
  emit?: (event: string, payload: unknown) => void
}

/**
 * Execute a declarative submit: interpolate the mutation binding, dispatch it
 * to the registered mutation resolver, then apply `onSuccess` effects.
 * Headless — the react adapter exposes this as `ctx.actions.submit`.
 */
export async function runSubmit(runtime: SubmitRuntime, submit: SubmitSpec, payload: unknown): Promise<unknown> {
  if (runtime.allowedActions && submit.action !== undefined && !runtime.allowedActions.includes(submit.action)) {
    throw new Error(`action ${submit.action} is not allowed in this scope`)
  }

  const snapshot = runtime.variables.snapshot()
  const resolved = interpolate(submit.mutation, snapshot)
  if (resolved.unresolved.size > 0) {
    throw new Error(`unresolved variables in mutation binding: ${[...resolved.unresolved].join(', ')}`)
  }

  const binding = resolved.value as MutationBinding
  const resolver = runtime.getMutationResolver(binding.target)
  if (!resolver) {
    throw new Error(`mutation resolver ${binding.target} is not registered`)
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
  }

  return result
}
