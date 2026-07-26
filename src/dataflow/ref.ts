import type { DataflowRef } from '../core/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDataflowRef(value: unknown): value is DataflowRef {
  if (!isRecord(value) || typeof value.$dataflow !== 'string') return false
  if (value.path !== undefined && typeof value.path !== 'string') return false
  return Object.keys(value).every((key) => key === '$dataflow' || key === 'path')
}

/**
 * Scan a binding (or any JSON value) for `{"$dataflow": "name"}` references.
 * Drives `useNodeVersion`'s re-render scoping (a resource only re-renders for
 * a dataflow value it actually references) and validation's declared-name
 * check — dataflow refs are document-wide, never tree-position-gated.
 */
export function scanDataflowRefs(value: unknown): DataflowRef[] {
  const refs: DataflowRef[] = []

  const visit = (current: unknown) => {
    if (isDataflowRef(current)) {
      refs.push(current)
      return
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }
    if (isRecord(current)) {
      for (const item of Object.values(current)) visit(item)
    }
  }

  visit(value)
  return refs
}
