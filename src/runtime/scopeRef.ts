import type { ScopeRef } from '../core/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isScopeRef(value: unknown): value is ScopeRef {
  if (!isRecord(value) || typeof value.$scope !== 'string') return false
  if (value.path !== undefined && typeof value.path !== 'string') return false
  return Object.keys(value).every((key) => key === '$scope' || key === 'path')
}

/**
 * Scan a binding (or any JSON value) for `{"$scope": "name"}` references.
 * Drives `useNodeVersion`'s re-render scoping — a resource only re-renders
 * for a scope change it actually references.
 */
export function scanScopeRefs(value: unknown): ScopeRef[] {
  const refs: ScopeRef[] = []

  const visit = (current: unknown) => {
    if (isScopeRef(current)) {
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
