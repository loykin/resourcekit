import { setValueAtPath } from '../core/path'
import type { ObjectStateDeclaration, ObjectStateRef } from '../core/types'
import { runtimeKeys } from './store'
import type { RuntimeStore } from './store'

/**
 * Writable, object-shaped local runtime state — the structured counterpart
 * to `variables` (flat `string | string[]` only). Backed directly by
 * `RuntimeStore`, no fetch, no dependency graph: a plain named slot any kind
 * can read/write via `ObjectStateRef` bindings (`Resource.bindings`,
 * `Resource.record`). Used for shared, externally-mutable objects (e.g.
 * `FormView`'s `draft` port) that `variables`' flat-string constraint can't
 * carry.
 */
export interface ObjectStateEngine {
  declare(declarations: ObjectStateDeclaration[]): void
  get(name: string): unknown
  set(name: string, value: unknown): void
  setPath(name: string, path: string, value: unknown): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isObjectStateRef(value: unknown): value is ObjectStateRef {
  if (!isRecord(value) || typeof value.$state !== 'string') return false
  if (value.path !== undefined && typeof value.path !== 'string') return false
  return Object.keys(value).every((key) => key === '$state' || key === 'path')
}

export function scanObjectStateRefs(value: unknown): ObjectStateRef[] {
  const refs: ObjectStateRef[] = []

  const visit = (current: unknown) => {
    if (isObjectStateRef(current)) {
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

export function createObjectStateEngine(store: RuntimeStore, scope = 'document'): ObjectStateEngine {
  return {
    declare(declarations) {
      for (const declaration of declarations) {
        const key = runtimeKeys.objectState(declaration.name, scope)
        if (!store.read(key)) {
          store.publish(key, { status: 'ready', value: declaration.initialValue })
        }
      }
    },
    get(name) {
      return store.read(runtimeKeys.objectState(name, scope))?.value
    },
    set(name, value) {
      store.publish(runtimeKeys.objectState(name, scope), { status: 'ready', value })
    },
    setPath(name, path, value) {
      const key = runtimeKeys.objectState(name, scope)
      const current = store.read(key)?.value
      store.publish(key, { status: 'ready', value: setValueAtPath(current, path, value) })
    },
  }
}
