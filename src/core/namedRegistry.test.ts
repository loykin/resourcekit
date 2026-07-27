import { describe, expect, it } from 'vitest'
import { allowListFilter, createNamedRegistry, scopedView } from './namedRegistry'
import type { ScopeOptions } from './types'

describe('createNamedRegistry', () => {
  it('registers, reads, lists, and removes values by key', () => {
    const registry = createNamedRegistry<number>()
    registry.register('a', 1)
    registry.register('b', 2)

    expect(registry.get('a')).toBe(1)
    expect(registry.get('missing')).toBeUndefined()
    expect(registry.list().sort()).toEqual([1, 2])
    expect(registry.keys().sort()).toEqual(['a', 'b'])

    registry.remove('a')
    expect(registry.get('a')).toBeUndefined()
    expect(registry.keys()).toEqual(['b'])
  })

  it('a later register with the same key overwrites the earlier one', () => {
    const registry = createNamedRegistry<string>()
    registry.register('x', 'first')
    registry.register('x', 'second')
    expect(registry.get('x')).toBe('second')
    expect(registry.list()).toEqual(['second'])
  })
})

describe('scopedView', () => {
  const emptyOptions: ScopeOptions = {}

  it('passes every value through when the filter allows everything', () => {
    const registry = createNamedRegistry<number>()
    registry.register('a', 1)
    registry.register('b', 2)
    const view = scopedView(registry, emptyOptions, { allowed: () => true })

    expect(view.get('a')).toBe(1)
    expect(view.list().sort()).toEqual([1, 2])
    expect(view.keys().sort()).toEqual(['a', 'b'])
  })

  it('hides values the filter rejects, both from get and list/keys', () => {
    const registry = createNamedRegistry<number>()
    registry.register('a', 1)
    registry.register('b', 2)
    const view = scopedView(registry, emptyOptions, { allowed: (key) => key !== 'b' })

    expect(view.get('a')).toBe(1)
    expect(view.get('b')).toBeUndefined()
    expect(view.list()).toEqual([1])
    expect(view.keys()).toEqual(['a'])
  })

  it('applies an optional transform only to allowed values', () => {
    const registry = createNamedRegistry<number>()
    registry.register('a', 1)
    registry.register('b', 2)
    const view = scopedView(registry, emptyOptions, {
      allowed: (key) => key === 'a',
      transform: (value) => value * 10,
    })

    expect(view.get('a')).toBe(10)
    expect(view.get('b')).toBeUndefined()
    expect(view.list()).toEqual([10])
  })

  it('threads options through to the filter', () => {
    const registry = createNamedRegistry<number>()
    registry.register('a', 1)
    const options: ScopeOptions = { dataSourceManifests: { exclude: ['a'] } }
    const view = scopedView(registry, options, {
      allowed: (key, _value, opts) => allowListFilter(key, opts.dataSourceManifests),
    })

    expect(view.get('a')).toBeUndefined()
  })
})

describe('allowListFilter', () => {
  it('allows everything when no include/exclude is set', () => {
    expect(allowListFilter('anything', undefined)).toBe(true)
    expect(allowListFilter('anything', {})).toBe(true)
  })

  it('exclude wins over include', () => {
    expect(allowListFilter('a', { include: ['a'], exclude: ['a'] })).toBe(false)
  })

  it('include narrows to only the listed keys', () => {
    expect(allowListFilter('a', { include: ['a'] })).toBe(true)
    expect(allowListFilter('b', { include: ['a'] })).toBe(false)
  })

  it('exclude removes only the listed keys, leaving others open', () => {
    expect(allowListFilter('a', { exclude: ['b'] })).toBe(true)
    expect(allowListFilter('b', { exclude: ['b'] })).toBe(false)
  })
})
