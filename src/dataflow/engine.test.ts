import { describe, expect, it, vi } from 'vitest'
import { createMemoryRuntimeStore, runtimeKeys } from '../runtime/store'
import { createVariableEngine } from '../runtime/variables'
import { createDataflowEngine } from './engine'

function setup() {
  const store = createMemoryRuntimeStore()
  const variables = createVariableEngine(store, 'test')
  return { store, variables }
}

describe('createDataflowEngine', () => {
  it('fetches a root unit (no dependOn) eagerly with zero consumers reading it', async () => {
    const { store, variables } = setup()
    const resolve = vi.fn(async () => [{ id: 1 }])
    const engine = createDataflowEngine({ store, scope: 'test', variables, resolve })

    engine.declare([{ name: 'rows', binding: { source: 'query' } }])
    await Promise.resolve()
    await Promise.resolve()

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(engine.status('rows')).toBe('ready')
    expect(engine.read('rows')).toEqual([{ id: 1 }])
  })

  it('gates a dependent unit until its dependOn target is ready, firing exactly once', async () => {
    const { store, variables } = setup()
    let resolveList: (value: Record<string, unknown>[]) => void = () => {}
    const resolve = vi.fn((binding: { source: string }) => {
      if (binding.source === 'list') return new Promise<Record<string, unknown>[]>((resolve) => { resolveList = resolve })
      return Promise.resolve([{ id: 'detail' }])
    })
    const engine = createDataflowEngine({ store, scope: 'test', variables, resolve })

    engine.declare([
      { name: 'list', binding: { source: 'list' } },
      { name: 'detail', binding: { source: 'detail' }, dependOn: ['list'] },
    ])
    await Promise.resolve()

    expect(engine.status('list')).toBe('pending')
    expect(engine.status('detail')).toBeUndefined()
    expect(resolve).toHaveBeenCalledTimes(1)

    resolveList([{ id: 'a' }])
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(engine.status('list')).toBe('ready')
    expect(engine.status('detail')).toBe('ready')
    expect(engine.read('detail')).toEqual([{ id: 'detail' }])
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('gates through a dependOn chain of depth 2', async () => {
    const { store, variables } = setup()
    const order: string[] = []
    const resolve = vi.fn(async (binding: { source: string }) => {
      order.push(binding.source)
      return [{ id: binding.source }]
    })
    const engine = createDataflowEngine({ store, scope: 'test', variables, resolve })

    engine.declare([
      { name: 'c', binding: { source: 'c' }, dependOn: ['b'] },
      { name: 'b', binding: { source: 'b' }, dependOn: ['a'] },
      { name: 'a', binding: { source: 'a' } },
    ])

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(engine.status('a')).toBe('ready')
    expect(engine.status('b')).toBe('ready')
    expect(engine.status('c')).toBe('ready')
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('refetch forces re-execution despite an unchanged fingerprint', async () => {
    const { store, variables } = setup()
    const resolve = vi.fn().mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ id: 2 }])
    const engine = createDataflowEngine({ store, scope: 'test', variables, resolve })

    engine.declare([{ name: 'rows', binding: { source: 'query' } }])
    await Promise.resolve()
    await Promise.resolve()
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(engine.read('rows')).toEqual([{ id: 1 }])

    await engine.refetch(['rows'])
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(engine.read('rows')).toEqual([{ id: 2 }])
  })

  it('invalidate marks the snapshot stale in place without re-executing (no coordinator wired)', async () => {
    const { store, variables } = setup()
    const resolve = vi.fn(async () => [{ id: 1 }])
    const engine = createDataflowEngine({ store, scope: 'test', variables, resolve })

    engine.declare([{ name: 'rows', binding: { source: 'query' } }])
    await Promise.resolve()
    await Promise.resolve()
    expect(resolve).toHaveBeenCalledTimes(1)

    engine.invalidate(['rows'])
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(store.read(runtimeKeys.dataflow('rows', 'test'))?.isStale).toBe(true)
    expect(engine.status('rows')).toBe('ready')
  })

  it('ignores a stale fetch that settles after a newer one (variable-driven re-run)', async () => {
    const { store, variables } = setup()
    variables.declare([{ name: 'sel', default: 'a' }])
    const deferred: Array<(rows: Record<string, unknown>[]) => void> = []
    const resolve = vi.fn(() => new Promise<Record<string, unknown>[]>((resolve) => deferred.push(resolve)))
    const engine = createDataflowEngine({ store, scope: 'test', variables, resolve })

    engine.declare([{ name: 'rows', binding: { source: 'query', id: '${sel}' } }])
    await Promise.resolve()
    expect(resolve).toHaveBeenCalledTimes(1)

    variables.set('sel', 'b')
    await Promise.resolve()
    expect(resolve).toHaveBeenCalledTimes(2)

    // Resolve out of order: the newer (sel=b) fetch settles first, then the
    // stale (sel=a) one settles after.
    deferred[1]([{ id: 'b' }])
    await Promise.resolve()
    expect(engine.read('rows')).toEqual([{ id: 'b' }])

    deferred[0]([{ id: 'a' }])
    await Promise.resolve()
    expect(engine.read('rows')).toEqual([{ id: 'b' }])
  })
})
