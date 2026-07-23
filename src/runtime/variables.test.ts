import { describe, expect, it } from 'vitest'
import { createVariableEngine, interpolate, scanVariableRefs } from './variables'

describe('createVariableEngine', () => {
  it('declares defaults, snapshots values, and notifies changed variables', () => {
    const engine = createVariableEngine()
    const changed: string[][] = []
    engine.subscribe((names) => changed.push([...names]))

    engine.declare([
      { name: 'customerId', default: 'c1' },
      { name: 'statuses', type: 'string[]', default: ['active'] },
    ])
    engine.set('customerId', 'c2')

    expect(engine.get('customerId')).toBe('c2')
    expect(engine.snapshot()).toEqual({ customerId: 'c2', statuses: ['active'] })
    expect(changed).toEqual([['customerId', 'statuses'], ['customerId']])
  })
})

describe('scanVariableRefs', () => {
  it('walks JSON values and collects interpolation references', () => {
    expect(
      scanVariableRefs({
        url: '/api/customers/${customerId}',
        body: { status: '${status}' },
        untouched: '${1bad}',
      }),
    ).toEqual(new Set(['customerId', 'status']))
  })
})

describe('interpolate', () => {
  it('preserves exact replacement types and comma-joins embedded arrays', () => {
    const result = interpolate(
      {
        exact: '${ids}',
        url: '/api/items?ids=${ids}&customer=${customerId}',
        missing: '${missing}',
      },
      { ids: ['a', 'b'], customerId: 'c1' },
    )

    expect(result.value).toEqual({
      exact: ['a', 'b'],
      url: '/api/items?ids=a,b&customer=c1',
      missing: '${missing}',
    })
    expect(result.unresolved).toEqual(new Set(['missing']))
  })
})
