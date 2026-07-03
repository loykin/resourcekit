import type { VariableValue } from './types'

/**
 * Dot-path lookup — the single path syntax used across the runtime
 * (`rowsPath`, event `from`, `fieldRef`, submit effect `from`).
 * Deliberately not JSONPath: array selection and filtering belong to the
 * resolver or backend, not to UI bindings.
 */
export function getValueAtPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value
  return path.split('.').reduce<unknown>((current, part) => {
    if (typeof current !== 'object' || current === null) return undefined
    return (current as Record<string, unknown>)[part]
  }, value)
}

/** Narrow an arbitrary value to what the variable engine can hold. */
export function coerceVariableValue(value: unknown): VariableValue {
  if (typeof value === 'string' || value === undefined) return value
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value
  if (value === null) return undefined
  return String(value)
}
