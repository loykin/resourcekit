import { describe, expect, it } from 'vitest'
import { coerceVariableValue, getValueAtPath, setValueAtPath } from './path'

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

describe('setValueAtPath', () => {
  it('sets a top-level field without disturbing siblings', () => {
    expect(setValueAtPath({ command: 'old', name: 'nginx' }, 'command', 'new')).toEqual({ command: 'new', name: 'nginx' })
  })

  it('sets a nested field, creating and preserving intermediate objects', () => {
    const draft = { process: { command: 'old', name: 'nginx' }, other: 'untouched' }
    expect(setValueAtPath(draft, 'process.command', 'new')).toEqual({ process: { command: 'new', name: 'nginx' }, other: 'untouched' })
  })

  it('does not mutate the original value', () => {
    const draft = { a: { b: 1 } }
    const result = setValueAtPath(draft, 'a.b', 2)
    expect(draft.a.b).toBe(1)
    expect(result).not.toBe(draft)
  })

  it('treats a missing or non-object intermediate as an empty object instead of throwing', () => {
    expect(setValueAtPath(undefined, 'a.b', 1)).toEqual({ a: { b: 1 } })
    expect(setValueAtPath({ a: 'not an object' }, 'a.b', 1)).toEqual({ a: { b: 1 } })
  })

  it('round-trips with getValueAtPath', () => {
    const result = setValueAtPath({ a: { b: 1, c: 2 } }, 'a.b', 99)
    expect(getValueAtPath(result, 'a.b')).toBe(99)
    expect(getValueAtPath(result, 'a.c')).toBe(2)
  })
})
