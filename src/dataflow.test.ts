import { describe, expect, it, vi } from 'vitest'
import {
  DataGraphValidationError,
  clampQueryPolicy,
  createDataflowRuntime,
  createMemoryDataStore,
  resolveDataRefs,
  scanDataRefs,
  validateDataGraph,
} from './dataflow'
import type { DataBinding } from './types'

describe('clampQueryPolicy', () => {
  it('passes an undefined policy through', () => {
    expect(clampQueryPolicy(undefined, { minIntervalMs: 1000 })).toBeUndefined()
  })

  it('raises a refresh interval below the host minimum', () => {
    const clamped = clampQueryPolicy({ refresh: { kind: 'interval', ms: 100 } }, { minIntervalMs: 1000 })
    expect(clamped?.refresh).toEqual({ kind: 'interval', ms: 1000 })
  })

  it('lowers a refresh interval above the host maximum', () => {
    const clamped = clampQueryPolicy({ refresh: { kind: 'interval', ms: 60_000 } }, { maxIntervalMs: 30_000 })
    expect(clamped?.refresh).toEqual({ kind: 'interval', ms: 30_000 })
  })

  it('drops refresh entirely when the host disallows polling', () => {
    const clamped = clampQueryPolicy({ refresh: { kind: 'interval', ms: 5000 } }, { allowPolling: false })
    expect(clamped?.refresh).toBeUndefined()
  })

  it('caps retry attempts to the host maximum', () => {
    const clamped = clampQueryPolicy({ retry: { maxAttempts: 10 } }, { maxRetries: 3 })
    expect(clamped?.retry).toEqual({ maxAttempts: 3 })
  })

  it('leaves a policy already within bounds untouched', () => {
    const policy = { refresh: { kind: 'interval' as const, ms: 5000 }, retry: { maxAttempts: 2 } }
    expect(clampQueryPolicy(policy, { minIntervalMs: 1000, maxIntervalMs: 10_000, maxRetries: 5 })).toEqual(policy)
  })

  it('is a no-op with no host scope policy', () => {
    const policy = { refresh: { kind: 'interval' as const, ms: 10 } }
    expect(clampQueryPolicy(policy, undefined)).toEqual(policy)
  })
})

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

  describe('publish', () => {
    it('writes an externally-produced value and propagates it to descendants', async () => {
      const runtime = createDataflowRuntime({
        graph: {
          nodes: {
            processes: { kind: 'resolve', binding: { source: 'poll' } },
            summary: { kind: 'resolve', binding: { source: 'test', rows: { $data: 'processes' } } },
          },
        },
        resolve: async (binding) => {
          const b = binding as DataBinding & { rows?: unknown[] }
          if (b.source === 'poll') return []
          return (b.rows ?? []).length
        },
      })

      await runtime.start()
      expect(await runtime.resolve('summary')).toBe(0)

      await runtime.publish('processes', { status: 'ready', value: [{ id: '1' }, { id: '2' }] })

      expect(await runtime.read('processes')).toEqual(expect.objectContaining({ status: 'ready', value: [{ id: '1' }, { id: '2' }] }))
      expect(await runtime.resolve('summary')).toBe(2)
    })

    it('propagates an error result to descendants', async () => {
      const runtime = createDataflowRuntime({
        graph: {
          nodes: {
            processes: { kind: 'resolve', binding: { source: 'poll' } },
            summary: { kind: 'resolve', binding: { source: 'test', rows: { $data: 'processes' } } },
          },
        },
        resolve: async () => [],
      })

      await runtime.start()
      await runtime.publish('processes', { status: 'error', error: new Error('poll failed') })

      await expect(runtime.resolve('processes')).rejects.toThrow('poll failed')
      await expect(runtime.resolve('summary')).rejects.toThrow('poll failed')
    })

    it('carries fetchStatus/isStale through to the stored snapshot', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { processes: { kind: 'resolve', binding: { source: 'poll' } } } },
        resolve: async () => [],
      })
      await runtime.start()

      await runtime.publish('processes', { status: 'ready', value: [{ id: '1' }], isStale: false, fetchStatus: 'idle' })
      expect(await runtime.read('processes')).toEqual(
        expect.objectContaining({ status: 'ready', value: [{ id: '1' }], isStale: false, fetchStatus: 'idle' }),
      )
    })

    it('retains the last-good value alongside a background refresh failure', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { processes: { kind: 'resolve', binding: { source: 'poll' } } } },
        resolve: async () => [{ id: '1' }],
      })
      await runtime.start()
      expect(await runtime.resolve('processes')).toEqual([{ id: '1' }])

      // A retainPreviousData refresh failure: report the new error but keep
      // showing the last-good value, flagged stale rather than cleared.
      await runtime.publish('processes', { status: 'error', error: new Error('refresh failed'), value: [{ id: '1' }], isStale: true })

      const snapshot = await runtime.read('processes')
      expect(snapshot).toEqual(
        expect.objectContaining({ status: 'error', value: [{ id: '1' }], isStale: true }),
      )
      expect((snapshot?.error as Error).message).toBe('refresh failed')
    })

    it('rejects publishing to a state node', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { selected: { kind: 'state', initialValue: 'a' } } },
        resolve: async () => undefined,
      })
      await runtime.start()
      await expect(runtime.publish('selected', { status: 'ready', value: 'b' })).rejects.toThrow('is not a resolve node')
    })

    it('rejects publishing to an unknown node', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { known: { kind: 'resolve', binding: { source: 'test' } } } },
        resolve: async () => undefined,
      })
      await runtime.start()
      await expect(runtime.publish('unknown', { status: 'ready', value: 1 })).rejects.toThrow('does not exist')
    })

    it('supersedes an in-flight internal resolve, discarding it even if it later settles', async () => {
      let releaseStaleResolve!: (value: string) => void
      const staleResolve = new Promise<string>((resolve) => {
        releaseStaleResolve = resolve
      })

      const runtime = createDataflowRuntime({
        graph: {
          nodes: {
            selection: { kind: 'state', initialValue: 'initial' },
            result: { kind: 'resolve', binding: { source: 'test', value: { $data: 'selection' } } },
          },
        },
        // Ignores the abort signal entirely — the generation check inside
        // evaluate(), not abort propagation, must be what protects the
        // published value once this stale execution eventually settles.
        resolve: (binding) => {
          const value = (binding as DataBinding & { value: string }).value
          return value === 'initial' ? Promise.resolve(value) : staleResolve
        },
      })

      await runtime.start()
      const stateWrite = runtime.setState('selection', 'triggers-slow-resolve')
      await vi.waitFor(async () => expect((await runtime.read('result'))?.status).toBe('pending'))

      await runtime.publish('result', { status: 'ready', value: 'published' })
      expect(await runtime.resolve('result')).toBe('published')

      releaseStaleResolve('stale-internal-value')
      await stateWrite // now free to settle: its evaluate() call discards the stale result and resolves

      expect(await runtime.resolve('result')).toBe('published')
    })
  })

  describe('setStatePath', () => {
    it('updates one field of a state node, leaving siblings untouched', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { draft: { kind: 'state', initialValue: { command: 'old', name: 'nginx' } } } },
        resolve: async () => undefined,
      })
      await runtime.start()

      await runtime.setStatePath('draft', 'command', 'nginx -g daemon off;')
      expect(await runtime.resolve('draft')).toEqual({ command: 'nginx -g daemon off;', name: 'nginx' })
    })

    it('same-tick calls to different paths of the same node both apply (explicit batch)', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { draft: { kind: 'state', initialValue: { command: 'old', name: 'old-name' } } } },
        resolve: async () => undefined,
      })
      await runtime.start()

      const first = runtime.setStatePath('draft', 'command', 'new-command')
      const second = runtime.setStatePath('draft', 'name', 'new-name')
      await Promise.all([first, second])

      expect(await runtime.resolve('draft')).toEqual({ command: 'new-command', name: 'new-name' })
    })

    it('setStatePaths applies patches to multiple nodes in one call', async () => {
      const runtime = createDataflowRuntime({
        graph: {
          nodes: {
            a: { kind: 'state', initialValue: { x: 1 } },
            b: { kind: 'state', initialValue: { y: 1 } },
          },
        },
        resolve: async () => undefined,
      })
      await runtime.start()

      await runtime.setStatePaths([
        { id: 'a', path: 'x', value: 2 },
        { id: 'b', path: 'y', value: 2 },
      ])

      expect(await runtime.resolve('a')).toEqual({ x: 2 })
      expect(await runtime.resolve('b')).toEqual({ y: 2 })
    })

    it('preserves real call order when a same-tick setState and setStatePath target the same node (patch after set)', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { draft: { kind: 'state', initialValue: { command: 'old', name: 'old-name' } } } },
        resolve: async () => undefined,
      })
      await runtime.start()

      // setState first, setStatePath second, same tick — the patch must win
      // for 'name' since it was called after the reset.
      const first = runtime.setState('draft', { command: 'default', name: 'default' })
      const second = runtime.setStatePath('draft', 'name', 'typed-value')
      await Promise.all([first, second])

      expect(await runtime.resolve('draft')).toEqual({ command: 'default', name: 'typed-value' })
    })

    it('preserves real call order when a same-tick setStatePath and setState target the same node (set after patch)', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { draft: { kind: 'state', initialValue: { command: 'old', name: 'old-name' } } } },
        resolve: async () => undefined,
      })
      await runtime.start()

      // setStatePath first, setState second, same tick — the later whole-value
      // set must win completely, not have the earlier patch survive on top.
      const first = runtime.setStatePath('draft', 'name', 'typed-value')
      const second = runtime.setState('draft', { command: 'reset', name: 'default' })
      await Promise.all([first, second])

      expect(await runtime.resolve('draft')).toEqual({ command: 'reset', name: 'default' })
    })

    it('rejects an empty path', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { draft: { kind: 'state', initialValue: {} } } },
        resolve: async () => undefined,
      })
      await runtime.start()
      await expect(runtime.setStatePath('draft', '', 'x')).rejects.toThrow('non-empty path')
    })

    it('rejects a resolve node target, same as setState', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { computed: { kind: 'resolve', binding: { source: 'test' } } } },
        resolve: async () => ({}),
      })
      await runtime.start()
      await expect(runtime.setStatePath('computed', 'x', 1)).rejects.toThrow('not writable state')
    })
  })

  describe('invalidate / refetch', () => {
    it('invalidate marks a resolve node stale without re-executing it', async () => {
      const resolve = vi.fn(async () => 'v1')
      const runtime = createDataflowRuntime({
        graph: { nodes: { customers: { kind: 'resolve', binding: { source: 'test' } } } },
        resolve,
      })
      await runtime.start()
      expect(resolve).toHaveBeenCalledTimes(1)

      await runtime.invalidate(['customers'])

      expect(resolve).toHaveBeenCalledTimes(1) // still just the initial run
      const snapshot = await runtime.read('customers')
      expect(snapshot).toEqual(expect.objectContaining({ status: 'ready', value: 'v1', isStale: true }))
    })

    it('refetch re-runs a resolve node and its descendants even with no dependency change', async () => {
      const calls: string[] = []
      let version = 0
      const runtime = createDataflowRuntime({
        graph: {
          nodes: {
            customers: { kind: 'resolve', binding: { source: 'test', id: 'customers' } },
            summary: { kind: 'resolve', binding: { source: 'test', id: 'summary', rows: { $data: 'customers' } } },
          },
        },
        resolve: async (binding) => {
          const b = binding as DataBinding & { id: string }
          calls.push(b.id)
          if (b.id === 'customers') return ++version
          return `derived-from-${version}`
        },
      })
      await runtime.start()
      calls.length = 0

      await runtime.refetch(['customers'])

      expect(calls).toEqual(['customers', 'summary'])
      expect(await runtime.resolve('customers')).toBe(2)
      expect(await runtime.resolve('summary')).toBe('derived-from-2')
    })

    it('refetch clears an isStale flag set by a prior invalidate', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { customers: { kind: 'resolve', binding: { source: 'test' } } } },
        resolve: async () => 'value',
      })
      await runtime.start()
      await runtime.invalidate(['customers'])
      expect((await runtime.read('customers'))?.isStale).toBe(true)

      await runtime.refetch(['customers'])
      expect((await runtime.read('customers'))?.isStale).toBeUndefined()
    })

    it('rejects a state node target for both invalidate and refetch', async () => {
      const runtime = createDataflowRuntime({
        graph: { nodes: { selected: { kind: 'state', initialValue: 'a' } } },
        resolve: async () => undefined,
      })
      await runtime.start()
      await expect(runtime.invalidate(['selected'])).rejects.toThrow('not a resolve node')
      await expect(runtime.refetch(['selected'])).rejects.toThrow('not a resolve node')
    })
  })
})
