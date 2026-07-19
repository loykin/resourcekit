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

/**
 * Immutable dot-path set — the write-side counterpart to `getValueAtPath`
 * (human-editing-and-persistence.md / docs/dataflow-and-server-state-
 * direction.md "Resource binding에서 필요한 수정"): a writable binding with a
 * `path` must update only that sub-field, not replace the whole node. Same
 * restriction as `getValueAtPath` — plain object traversal only, no array
 * indices. An intermediate segment that isn't currently an object is
 * treated as `{}` rather than throwing, so a draft object can be built up
 * field by field.
 */
export function setValueAtPath(value: unknown, path: string, next: unknown): unknown {
  const [head, ...rest] = path.split('.')
  const base = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  if (rest.length === 0) return { ...base, [head]: next }
  return { ...base, [head]: setValueAtPath(base[head], rest.join('.'), next) }
}

/**
 * Narrow an arbitrary value to what the variable engine can hold.
 *
 * `null` becomes `''`, not `undefined`: `null` is an explicit "cleared"
 * signal (e.g. a clearable FilterControl's onChange), and `undefined` means
 * "not yet resolved" to the runtime — a binding referencing an `undefined`
 * variable is treated as not ready and resolves to no rows (see
 * `resolveThroughRuntime`'s `unresolved` check) rather than "no filter
 * applied." Collapsing an explicit clear into that same unresolved state
 * made every binding depending on a cleared filter go blank instead of
 * showing unfiltered results.
 */
export function coerceVariableValue(value: unknown): VariableValue {
  if (typeof value === 'string' || value === undefined) return value
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value
  if (value === null) return ''
  return String(value)
}
