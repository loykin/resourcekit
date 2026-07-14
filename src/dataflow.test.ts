import { describe, expect, it, vi } from 'vitest'
import {
  DataGraphValidationError,
  createDataflowRuntime,
  createMemoryDataStore,
  resolveDataRefs,
  scanDataRefs,
  validateDataGraph,
} from './dataflow'
import type { DataBinding } from './types'

describe('data references', () => {
  it('scans and resolves structural references recursively', () => {
    const value = {
      request: {
        cluster: { $data: 'selection' },
        region: { $data: 'metadata', path: 'region.name' },
      },
    }

    expect(scanDataRefs(value)).toEqual([
      { $data: 'selection' },
      { $data: 'metadata', path: 'region.name' },
    ])
    expect(
      resolveDataRefs(
        value,
        new Map([
          ['selection', { status: 'ready', value: 'cluster-a', version: 1, epoch: 1 }],
          ['metadata', { status: 'ready', value: { region: { name: 'apne2' } }, version: 2, epoch: 1 }],
        ]),
      ),
    ).toEqual({ request: { cluster: 'cluster-a', region: 'apne2' } })
  })
})

describe('validateDataGraph', () => {
  it('reports missing references, invalid references and cycles', () => {
    const missing = validateDataGraph({
      nodes: {
        result: { kind: 'resolve', binding: { source: 'test', value: { $data: 'missing' } } },
      },
    })
    expect(missing.issues).toContainEqual(expect.objectContaining({ code: 'missing-ref' }))

    const invalid = validateDataGraph({
      nodes: {
        result: { kind: 'resolve', binding: { source: 'test', value: { $data: 42 } } },
      },
    })
    expect(invalid.issues).toContainEqual(expect.objectContaining({ code: 'invalid-ref' }))

    const cycle = validateDataGraph({
      nodes: {
        left: { kind: 'resolve', binding: { source: 'test', value: { $data: 'right' } } },
        right: { kind: 'resolve', binding: { source: 'test', value: { $data: 'left' } } },
      },
    })
    expect(cycle.issues).toContainEqual(expect.objectContaining({ code: 'cycle' }))
    expect(() =>
      createDataflowRuntime({
        graph: { nodes: { self: { kind: 'resolve', binding: { source: 'test', value: { $data: 'self' } } } } },
        resolve: async () => undefined,
      }),
    ).toThrow(DataGraphValidationError)
  })
})

describe('createDataflowRuntime', () => {
  it('resolves inline references and invalidates only descendants', async () => {
    const calls: string[] = []
    const runtime = createDataflowRuntime({
      graph: {
        nodes: {
          leftState: { kind: 'state', initialValue: 'L1' },
          rightState: { kind: 'state', initialValue: 'R1' },
          left: { kind: 'resolve', binding: { source: 'test', id: 'left', value: { $data: 'leftState' } } },
          right: { kind: 'resolve', binding: { source: 'test', id: 'right', value: { $data: 'rightState' } } },
          joined: {
            kind: 'resolve',
            binding: { source: 'test', id: 'joined', left: { $data: 'left' }, right: { $data: 'right' } },
          },
        },
      },
      resolve: async (binding) => {
        const current = binding as DataBinding & { id: string; value?: unknown; left?: unknown; right?: unknown }
        calls.push(current.id)
        return current.id === 'joined' ? `${current.left}:${current.right}` : current.value
      },
    })

    await runtime.start()
    expect(await runtime.resolve('joined')).toBe('L1:R1')
    calls.length = 0

    await runtime.setState('leftState', 'L2')
    expect(await runtime.resolve('joined')).toBe('L2:R1')
    expect(calls).toContain('left')
    expect(calls).toContain('joined')
    expect(calls).not.toContain('right')
  })

  it('coalesces same-tick writes and gives fan-in one coherent snapshot', async () => {
    const joined: string[] = []
    const runtime = createDataflowRuntime({
      graph: {
        nodes: {
          left: { kind: 'state', initialValue: 'L1' },
          right: { kind: 'state', initialValue: 'R1' },
          joined: {
            kind: 'resolve',
            binding: { source: 'test', left: { $data: 'left' }, right: { $data: 'right' } },
          },
        },
      },
      resolve: async (binding) => {
        const current = binding as DataBinding & { left: string; right: string }
        const value = `${current.left}:${current.right}`
        joined.push(value)
        return value
      },
    })

    await runtime.start()
    joined.length = 0
    const leftWrite = runtime.setState('left', 'L2')
    const rightWrite = runtime.setState('right', 'R2')
    await Promise.all([leftWrite, rightWrite])

    expect(joined).toEqual(['L2:R2'])
    expect(await runtime.resolve('joined')).toBe('L2:R2')
  })

  it('aborts obsolete executions and keeps the latest result', async () => {
    const started: string[] = []
    const aborted: string[] = []
    const runtime = createDataflowRuntime({
      graph: {
        nodes: {
          selection: { kind: 'state', initialValue: 'initial' },
          result: { kind: 'resolve', binding: { source: 'test', value: { $data: 'selection' } } },
        },
      },
      resolve: (binding, context) => {
        const value = (binding as DataBinding & { value: string }).value
        started.push(value)
        if (value === 'initial') return Promise.resolve(value)
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(value), value === 'slow' ? 1_000 : 1)
          context.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            aborted.push(value)
            reject(new Error('aborted'))
          })
        })
      },
    })

    await runtime.start()
    const slow = runtime.setState('selection', 'slow')
    await vi.waitFor(() => expect(started).toContain('slow'))
    const fast = runtime.setState('selection', 'fast')
    await Promise.all([slow, fast])

    expect(aborted).toContain('slow')
    expect(await runtime.resolve('result')).toBe('fast')
  })

  it('can use a host-provided store', async () => {
    const store = createMemoryDataStore()
    const runtime = createDataflowRuntime({
      graph: { nodes: { selected: { kind: 'state', initialValue: 'a' } } },
      store,
      resolve: async () => undefined,
    })

    await runtime.start()
    await runtime.setState('selected', 'b')
    expect(await store.read('selected')).toEqual(expect.objectContaining({ status: 'ready', value: 'b' }))
  })

  it('marks downstream nodes as errors instead of preserving stale results when an upstream fails', async () => {
    const runtime = createDataflowRuntime({
      graph: {
        nodes: {
          selected: { kind: 'state', initialValue: 'ok' },
          upstream: { kind: 'resolve', binding: { source: 'test', value: { $data: 'selected' } } },
          downstream: { kind: 'resolve', binding: { source: 'test', value: { $data: 'upstream' } } },
        },
      },
      resolve: async (binding) => {
        const value = (binding as DataBinding & { value: string }).value
        if (value === 'fail') throw new Error('upstream failed')
        return value
      },
    })

    await runtime.start()
    expect(await runtime.resolve('downstream')).toBe('ok')
    await runtime.setState('selected', 'fail')

    await expect(runtime.resolve('upstream')).rejects.toThrow('upstream failed')
    await expect(runtime.resolve('downstream')).rejects.toThrow('upstream failed')
  })
})
