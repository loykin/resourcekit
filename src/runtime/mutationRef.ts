import type { MutationRef } from '../core/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isMutationRef(value: unknown): value is MutationRef {
  if (!isRecord(value) || typeof value.$mutation !== 'string') return false
  return Object.keys(value).every((key) => key === '$mutation')
}

/**
 * Scan `submit.mutation` (or any JSON value) for `{"$mutation": "name"}`
 * references. Used by validation's declared-name check — mutations are
 * document-wide, never tree-position-gated, same convention as
 * `scanDataflowRefs`. Unlike dataflow refs, this never drives a re-render
 * subscription: a mutation ref only resolves inside `runSubmit`, never
 * through `ctx.data.resolve`.
 */
export function scanMutationRefs(value: unknown): MutationRef[] {
  const refs: MutationRef[] = []

  const visit = (current: unknown) => {
    if (isMutationRef(current)) {
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
