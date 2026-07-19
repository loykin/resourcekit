import { describe, expect, it } from 'vitest'
import { canonicalizeJson, canonicalizeResource, canonicalStringify } from './canonical'
import type { Resource } from './types'

describe('canonicalizeJson', () => {
  it('sorts object keys lexicographically at every depth', () => {
    const value = { b: 1, a: { d: 2, c: 3 } }
    expect(Object.keys(canonicalizeJson(value) as object)).toEqual(['a', 'b'])
    expect(Object.keys((canonicalizeJson(value) as { a: object }).a)).toEqual(['c', 'd'])
  })

  it('drops undefined-valued keys but keeps null', () => {
    const value = { a: undefined, b: null, c: 1 }
    expect(canonicalizeJson(value)).toEqual({ b: null, c: 1 })
  })

  it('preserves array order and canonicalizes each element', () => {
    const value = [{ b: 1, a: 2 }, { d: 3, c: 4 }]
    expect(canonicalizeJson(value)).toEqual([
      { a: 2, b: 1 },
      { c: 4, d: 3 },
    ])
  })

  it('leaves primitives untouched', () => {
    expect(canonicalizeJson('x')).toBe('x')
    expect(canonicalizeJson(1)).toBe(1)
    expect(canonicalizeJson(null)).toBeNull()
  })

  it('two differently-ordered but equivalent documents canonicalize to the same value', () => {
    const a = { kind: 'Panel', apiVersion: 'v1', spec: { title: 'X', empty: undefined } }
    const b = { apiVersion: 'v1', spec: { title: 'X' }, kind: 'Panel' }
    expect(canonicalizeJson(a)).toEqual(canonicalizeJson(b))
  })
})

describe('canonicalStringify', () => {
  it('produces identical text for two key-order variants of the same document', () => {
    const a = { kind: 'Panel', apiVersion: 'v1' }
    const b = { apiVersion: 'v1', kind: 'Panel' }
    expect(canonicalStringify(a)).toBe(canonicalStringify(b))
  })
})

describe('canonicalizeResource', () => {
  it('canonicalizes a full Resource tree, including nested slots', () => {
    const resource: Resource = {
      kind: 'Panel',
      apiVersion: 'resourcekit.dev/v1alpha1',
      spec: { title: 'X' },
      slots: [{ items: [{ kind: 'Text', apiVersion: 'resourcekit.dev/v1alpha1', spec: { text: 'hi' } }] }],
    }
    const result = canonicalizeResource(resource)
    expect(Object.keys(result)).toEqual(['apiVersion', 'kind', 'slots', 'spec'])
  })
})
