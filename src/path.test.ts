import { describe, expect, it } from 'vitest'
import { coerceVariableValue, getValueAtPath } from './path'

describe('coerceVariableValue', () => {
  it('passes strings and arrays of strings through unchanged', () => {
    expect(coerceVariableValue('active')).toBe('active')
    expect(coerceVariableValue(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('treats undefined as "not yet resolved" (left as undefined)', () => {
    expect(coerceVariableValue(undefined)).toBeUndefined()
  })

  it('treats an explicit null (e.g. a cleared filter) as a resolved empty string, not undefined', () => {
    // A cleared value must stay a *resolved* string so bindings referencing
    // it via `${var}` still fire (with "no filter" semantics) instead of
    // being treated as not-ready and resolving to no rows.
    expect(coerceVariableValue(null)).toBe('')
  })

  it('stringifies other primitives', () => {
    expect(coerceVariableValue(42)).toBe('42')
    expect(coerceVariableValue(true)).toBe('true')
  })
})

describe('getValueAtPath', () => {
  it('reads a nested dot-path', () => {
    expect(getValueAtPath({ a: { b: 'c' } }, 'a.b')).toBe('c')
  })

  it('returns undefined for a missing path', () => {
    expect(getValueAtPath({ a: {} }, 'a.b.c')).toBeUndefined()
  })
})
