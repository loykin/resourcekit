import type { VariableDeclaration, VariableValue } from '../core/types'
import { runtimeKeys } from './store'
import type { RuntimeStore } from './store'

/**
 * v1 variable engine — deliberately flat.
 *
 * In scope: one page scope, string | string[] values, setVariable writes,
 * ${var} interpolation, dependency scan, readiness, URL persist.
 *
 * OUT of scope (dashboardkit's job — do not add here): chained variables,
 * options queries, include-all, dependency DAGs.
 */
export interface VariableEngine {
  declare(declarations: VariableDeclaration[]): void
  get(name: string): VariableValue
  set(name: string, value: VariableValue): void
  snapshot(): Record<string, VariableValue>
}

const VARIABLE_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)}/g

function sameValue(left: VariableValue, right: VariableValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index])
  }
  return left === right
}

function urlSearchParams(): URLSearchParams | undefined {
  const location = globalThis.location
  return location ? new URLSearchParams(location.search) : undefined
}

function readUrlValue(declaration: VariableDeclaration): VariableValue {
  if (declaration.persist !== 'url') return undefined
  const params = urlSearchParams()
  if (!params?.has(declaration.name)) return undefined
  if (declaration.type === 'string[]') return params.getAll(declaration.name)
  return params.get(declaration.name) ?? undefined
}

function writeUrlValue(name: string, value: VariableValue): void {
  const location = globalThis.location
  const history = globalThis.history
  if (!location || !history) return

  const url = new URL(location.href)
  url.searchParams.delete(name)
  if (Array.isArray(value)) {
    for (const item of value) url.searchParams.append(name, item)
  } else if (value !== undefined) {
    url.searchParams.set(name, value)
  }
  history.replaceState(history.state, '', url)
}

export function createVariableEngine(store: RuntimeStore, scope = 'document'): VariableEngine {
  const declared = new Set<string>()
  const persisted = new Set<string>()

  return {
    declare(declarations) {
      for (const declaration of declarations) {
        declared.add(declaration.name)
        if (declaration.persist === 'url') persisted.add(declaration.name)
        const next = readUrlValue(declaration) ?? declaration.default
        const key = runtimeKeys.variable(declaration.name, scope)
        if (!store.read(key)) {
          store.publish(key, { status: 'ready', value: next })
        }
      }
    },
    get(name) {
      return store.read(runtimeKeys.variable(name, scope))?.value as VariableValue
    },
    set(name, value) {
      const key = runtimeKeys.variable(name, scope)
      const current = store.read(key)?.value as VariableValue
      if (sameValue(current, value)) return
      declared.add(name)
      store.publish(key, { status: 'ready', value })
      if (persisted.has(name)) writeUrlValue(name, value)
    },
    snapshot() {
      return Object.fromEntries(
        [...declared].map((name) => [name, store.read(runtimeKeys.variable(name, scope))?.value as VariableValue]),
      )
    },
  }
}

/**
 * Scan a binding (or any JSON value) for `${var}` references.
 * Drives the reactivity graph: a resource re-resolves its data only when a
 * variable it references changes.
 */
export function scanVariableRefs(value: unknown): Set<string> {
  const refs = new Set<string>()

  const visit = (current: unknown) => {
    if (typeof current === 'string') {
      for (const match of current.matchAll(VARIABLE_REF_RE)) refs.add(match[1])
      return
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }
    if (typeof current === 'object' && current !== null) {
      if ('$variable' in current && typeof current.$variable === 'string') refs.add(current.$variable)
      for (const item of Object.values(current)) visit(item)
    }
  }

  visit(value)
  return refs
}

/**
 * Interpolate `${var}` references with current values. Returns the resolved
 * value plus whether any required reference was unresolved (readiness).
 */
export function interpolate(
  value: unknown,
  variables: Record<string, VariableValue>,
): { value: unknown; unresolved: Set<string> } {
  const unresolved = new Set<string>()

  const replaceString = (current: string): unknown => {
    const exact = current.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)}$/)
    if (exact) {
      const variable = exact[1]
      const replacement = variables[variable]
      if (replacement === undefined) {
        unresolved.add(variable)
        return current
      }
      return replacement
    }

    return current.replace(VARIABLE_REF_RE, (placeholder, variable: string) => {
      const replacement = variables[variable]
      if (replacement === undefined) {
        unresolved.add(variable)
        return placeholder
      }
      return Array.isArray(replacement) ? replacement.join(',') : replacement
    })
  }

  const visit = (current: unknown): unknown => {
    if (typeof current === 'string') return replaceString(current)
    if (Array.isArray(current)) return current.map((item) => visit(item))
    if (typeof current === 'object' && current !== null) {
      return Object.fromEntries(Object.entries(current).map(([key, item]) => [key, visit(item)]))
    }
    return current
  }

  return { value: visit(value), unresolved }
}
