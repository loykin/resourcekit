import { describe, expect, it, vi } from 'vitest'
import type { DataBinding, DataSourceManifest } from '../core/types'
import {
  createCoordinatorResolve,
  createDirectQueryCoordinator,
  type QueryCoordinator,
  type QueryHandle,
  type QueryRequest,
  type QuerySnapshot,
} from './coordinator'

const API_VERSION = 'resourcekit.dev/v1alpha1'

function binding(kind: string, spec: unknown = {}): DataBinding {
  return { apiVersion: API_VERSION, kind, spec } as DataBinding
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Subscribes before returning, so it can't miss a notify() that fires before the caller awaits. */
function waitFor(handle: QueryHandle, predicate: (snapshot: QuerySnapshot) => boolean): Promise<void> {
  if (predicate(handle.getSnapshot())) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = handle.subscribe(() => {
      if (!predicate(handle.getSnapshot())) return
      unsubscribe()
      resolve()
    })
  })
}

describe('createDirectQueryCoordinator', () => {
  it('executes on open and reports pending then ready', async () => {
    const coordinator = createDirectQueryCoordinator()
    const handle = coordinator.open({ nodeId: 'processes', key: ['processes'], execute: async () => [{ id: '1' }] })

    expect(handle.getSnapshot().status).toBe('pending')
    await waitFor(handle, (s) => s.status === 'ready')

    expect(handle.getSnapshot()).toEqual({ status: 'ready', value: [{ id: '1' }] })
  })

  it('reports error status when execute rejects', async () => {
    const coordinator = createDirectQueryCoordinator()
    const handle = coordinator.open({
      nodeId: 'processes',
      key: ['processes'],
      execute: async () => {
        throw new Error('boom')
      },
    })

    await waitFor(handle, (s) => s.status !== 'pending')

    expect(handle.getSnapshot().status).toBe('error')
    expect((handle.getSnapshot().error as Error).message).toBe('boom')
  })

  it('refetch() on the handle re-runs execute', async () => {
    const execute = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    const coordinator = createDirectQueryCoordinator()
    const handle = coordinator.open({ nodeId: 'n', key: ['n'], execute })

    await waitFor(handle, (s) => s.status === 'ready')
    expect(handle.getSnapshot().value).toBe('first')

    const done = waitFor(handle, (s) => s.value === 'second')
    await handle.refetch()
    await done

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('coordinator.refetch(nodeIds) re-runs every open handle for those node ids', async () => {
    const execute = vi.fn().mockResolvedValueOnce('a1').mockResolvedValueOnce('a2')
    const coordinator = createDirectQueryCoordinator()
    const handle = coordinator.open({ nodeId: 'a', key: ['a'], execute })
    const other = coordinator.open({ nodeId: 'b', key: ['b'], execute: async () => 'b1' })

    await waitFor(handle, (s) => s.status === 'ready')

    const done = waitFor(handle, (s) => s.value === 'a2')
    await coordinator.refetch(['a'])
    await done

    expect(execute).toHaveBeenCalledTimes(2)
    expect(other.getSnapshot().value).toBe('b1')
  })

  it('coordinator.invalidate(nodeIds) does not execute because the direct coordinator has no cache metadata', async () => {
    const execute = vi.fn(async () => 'value')
    const coordinator = createDirectQueryCoordinator()
    const handle = coordinator.open({ nodeId: 'a', key: ['a'], execute })
    await waitFor(handle, (snapshot) => snapshot.status === 'ready')

    await coordinator.invalidate(['a'])

    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('a stale execution that ignores cancellation cannot overwrite a newer result', async () => {
    const first = deferred<string>()
    let calls = 0
    const coordinator = createDirectQueryCoordinator()

    const handle = coordinator.open({
      nodeId: 'n',
      key: ['n'],
      // Ignores the abort signal entirely, simulating an adapter whose
      // underlying fetch doesn't honor cancellation — the generation guard,
      // not abort propagation, is what must protect the snapshot here.
      execute: async () => {
        calls++
        return calls === 1 ? first.promise : 'second'
      },
    })

    const secondReady = waitFor(handle, (s) => s.value === 'second')
    await handle.refetch() // starts the second (fast) run while the first is still pending
    await secondReady

    first.resolve('stale-first')
    await Promise.resolve()
    await Promise.resolve()

    expect(handle.getSnapshot()).toEqual({ status: 'ready', value: 'second' })
  })

  it('dispose() stops delivering updates and removes the handle from nodeId tracking', async () => {
    const coordinator = createDirectQueryCoordinator()
    const listener = vi.fn()
    const handle = coordinator.open({ nodeId: 'n', key: ['n'], execute: async () => 'value' })
    handle.subscribe(listener)

    handle.dispose()
    listener.mockClear()

    await coordinator.refetch(['n'])
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('createCoordinatorResolve', () => {
  function fakeRegistry(manifest?: DataSourceManifest) {
    return { getDataSourceManifest: () => manifest }
  }

  function stubCoordinator(open: QueryCoordinator['open']): QueryCoordinator {
    return { open, invalidate: async () => {}, refetch: async () => {} }
  }

  it('resolves with the value the coordinator eventually reports ready', async () => {
    const coordinator = createDirectQueryCoordinator()
    const resolveFn = vi.fn(async () => [{ id: '1' }])
    const bridge = createCoordinatorResolve({ coordinator, registry: fakeRegistry(), resolve: resolveFn })

    const result = await bridge.resolve(binding('processes'), { nodeId: 'processes', variables: {}, reason: 'initial' })

    expect(result).toEqual([{ id: '1' }])
    expect(resolveFn).toHaveBeenCalledWith(binding('processes'), expect.objectContaining({ nodeId: 'processes' }))
  })

  it('supports handles whose subscribe callback fires synchronously', async () => {
    let unsubscribeCalls = 0
    const coordinator = stubCoordinator(() => ({
      getSnapshot: () => ({ status: 'ready', value: 'synchronous' }),
      subscribe(listener) {
        listener()
        return () => {
          unsubscribeCalls++
        }
      },
      refetch: async () => {},
      dispose: () => {},
    }))
    const bridge = createCoordinatorResolve({ coordinator, registry: fakeRegistry(), resolve: async () => undefined })

    await expect(
      bridge.resolve(binding('sync'), { nodeId: 'sync', variables: {}, reason: 'initial' }),
    ).resolves.toBe('synchronous')
    expect(unsubscribeCalls).toBe(1)
  })

  it('rejects when the coordinator reports an error', async () => {
    const coordinator = createDirectQueryCoordinator()
    const bridge = createCoordinatorResolve({
      coordinator,
      registry: fakeRegistry(),
      resolve: async () => {
        throw new Error('backend down')
      },
    })

    await expect(bridge.resolve(binding('processes'), { nodeId: 'processes', variables: {}, reason: 'initial' })).rejects.toThrow('backend down')
  })

  it("uses the registered DataSourceManifest's queryKey when one exists for the binding kind", async () => {
    const opened: QueryRequest[] = []
    const coordinator = stubCoordinator((request) => {
      opened.push(request)
      return { getSnapshot: () => ({ status: 'ready', value: 'v' }), subscribe: () => () => {}, refetch: async () => {}, dispose: () => {} }
    })
    const manifest: DataSourceManifest = {
      apiVersion: API_VERSION,
      kind: 'processes',
      resolve: async () => [],
      queryKey: (b) => ['processes', (b.spec as { status?: string }).status],
    }
    const bridge = createCoordinatorResolve({ coordinator, registry: fakeRegistry(manifest), resolve: async () => 'v' })

    await bridge.resolve(binding('processes', { status: 'running' }), { nodeId: 'n', variables: {}, reason: 'initial' })

    expect(opened[0]?.key).toEqual(['processes', 'running'])
  })

  it('falls back to [nodeId, stableStringify(binding)] when no manifest is registered', async () => {
    const opened: QueryRequest[] = []
    const coordinator = stubCoordinator((request) => {
      opened.push(request)
      return { getSnapshot: () => ({ status: 'ready', value: 'v' }), subscribe: () => () => {}, refetch: async () => {}, dispose: () => {} }
    })
    const bridge = createCoordinatorResolve({ coordinator, registry: fakeRegistry(), resolve: async () => 'v' })

    await bridge.resolve(binding('processes', { a: 1, b: 2 }), { nodeId: 'n', variables: {}, reason: 'initial' })

    expect(opened[0]?.key).toEqual(['n', `{"apiVersion":"${API_VERSION}","kind":"processes","spec":{"a":1,"b":2}}`])
  })

  it('reuses the same handle (no reopen) across repeated resolve() calls with the same effective key, stable across key order', async () => {
    const opened: QueryRequest[] = []
    const coordinator = stubCoordinator((request) => {
      opened.push(request)
      return { getSnapshot: () => ({ status: 'ready', value: 'v' }), subscribe: () => () => {}, refetch: async () => {}, dispose: () => {} }
    })
    const bridge = createCoordinatorResolve({ coordinator, registry: fakeRegistry(), resolve: async () => 'v' })

    await bridge.resolve(binding('processes', { a: 1, b: 2 }), { nodeId: 'n', variables: {}, reason: 'initial' })
    await bridge.resolve(binding('processes', { b: 2, a: 1 }), { nodeId: 'n', variables: {}, reason: 'initial' })

    expect(opened).toHaveLength(1) // second call reused the cached handle instead of opening a new one
  })

  it('forces a cached handle to refetch when the resolve reason is refetch', async () => {
    let value = 'first'
    const resolveFn = vi.fn(async () => value)
    const bridge = createCoordinatorResolve({
      coordinator: createDirectQueryCoordinator(),
      registry: fakeRegistry(),
      resolve: resolveFn,
    })
    const b = binding('processes')

    await expect(bridge.resolve(b, { nodeId: 'n', variables: {}, reason: 'initial' })).resolves.toBe('first')
    value = 'second'
    await expect(bridge.resolve(b, { nodeId: 'n', variables: {}, reason: 'refetch' })).resolves.toBe('second')

    expect(resolveFn).toHaveBeenCalledTimes(2)
  })

  it('disposes the old handle and opens a new one when the computed key changes for the same nodeId', async () => {
    const disposed: string[] = []
    let openCount = 0
    const coordinator = stubCoordinator((request) => {
      openCount += 1
      const key = JSON.stringify(request.key)
      return {
        getSnapshot: () => ({ status: 'ready', value: key }),
        subscribe: () => () => {},
        refetch: async () => {},
        dispose: () => disposed.push(key),
      }
    })
    const bridge = createCoordinatorResolve({ coordinator, registry: fakeRegistry(), resolve: async () => 'v' })

    await bridge.resolve(binding('processes', { filter: 'a' }), { nodeId: 'n', variables: {}, reason: 'initial' })
    await bridge.resolve(binding('processes', { filter: 'b' }), { nodeId: 'n', variables: {}, reason: 'initial' })

    expect(openCount).toBe(2)
    expect(disposed).toHaveLength(1)
  })

  it('clamps the per-node policy against the scope ceiling and passes it to the coordinator', async () => {
    let seenPolicy: QueryRequest['policy']
    const coordinator = stubCoordinator((request) => {
      seenPolicy = request.policy
      return { getSnapshot: () => ({ status: 'ready', value: 'v' }), subscribe: () => () => {}, refetch: async () => {}, dispose: () => {} }
    })
    const bridge = createCoordinatorResolve({
      coordinator,
      registry: fakeRegistry(),
      resolve: async () => 'v',
      scopePolicy: { minIntervalMs: 5000 },
    })

    await bridge.resolve(
      binding('processes'),
      { nodeId: 'n', variables: {}, reason: 'initial', policy: { refresh: { kind: 'interval', ms: 100 } } },
    )

    expect(seenPolicy).toEqual({ refresh: { kind: 'interval', ms: 5000 } })
  })

  it('rejects this call on abort but keeps the handle cached (not disposed) for reuse', async () => {
    let disposed = false
    const coordinator = stubCoordinator(() => ({
      getSnapshot: () => ({ status: 'pending' }),
      subscribe: () => () => {},
      refetch: async () => {},
      dispose: () => {
        disposed = true
      },
    }))
    const bridge = createCoordinatorResolve({ coordinator, registry: fakeRegistry(), resolve: async () => 'v' })
    const controller = new AbortController()

    const promise = bridge.resolve(binding('processes'), { nodeId: 'n', variables: {}, reason: 'initial', signal: controller.signal })
    controller.abort(new Error('cancelled'))

    await expect(promise).rejects.toThrow('cancelled')
    expect(disposed).toBe(false)
  })

  it('calls onUpdate for a background snapshot change that happens after the initial resolve() settled', async () => {
    // A real coordinator supports multiple concurrent listeners (the bridge's
    // own persistent onUpdate-forwarder plus each resolve() call's temporary
    // settle-listener) — this stub mirrors that with a Set, unlike a
    // single-slot stub which would let the second subscribe overwrite the first.
    const listeners = new Set<() => void>()
    let snapshot: QuerySnapshot = { status: 'ready', value: 'first' }
    const coordinator = stubCoordinator(() => ({
      getSnapshot: () => snapshot,
      subscribe: (l) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      refetch: async () => {},
      dispose: () => {},
    }))
    const onUpdate = vi.fn()
    const bridge = createCoordinatorResolve({ coordinator, registry: fakeRegistry(), resolve: async () => 'v', onUpdate })

    await bridge.resolve(binding('processes'), { nodeId: 'n', variables: {}, reason: 'initial' })
    expect(onUpdate).not.toHaveBeenCalled() // the initial value went through the resolve() return value, not onUpdate

    snapshot = { status: 'ready', value: 'second' } // simulate a background poll producing a new value
    for (const listener of listeners) listener()

    expect(onUpdate).toHaveBeenCalledWith('n', { status: 'ready', value: 'second' })
  })

  it('suppresses coordinator invalidation echoes while forwarding the invalidation itself', async () => {
    const listeners = new Set<() => void>()
    const invalidate = vi.fn(async () => {
      for (const listener of listeners) listener()
    })
    const coordinator: QueryCoordinator = {
      open: () => ({
        getSnapshot: () => ({ status: 'ready', value: 'unchanged' }),
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        refetch: async () => {},
        dispose: () => {},
      }),
      invalidate,
      refetch: async () => {},
    }
    const onUpdate = vi.fn()
    const bridge = createCoordinatorResolve({
      coordinator,
      registry: fakeRegistry(),
      resolve: async () => 'unchanged',
      onUpdate,
    })
    await bridge.resolve(binding('processes'), { nodeId: 'n', variables: {}, reason: 'initial' })

    await bridge.invalidate(['n'])

    expect(invalidate).toHaveBeenCalledWith(['n'])
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('dispose() tears down every cached handle', async () => {
    const disposedNodes: string[] = []
    const coordinator = stubCoordinator((request) => ({
      getSnapshot: () => ({ status: 'ready', value: 'v' }),
      subscribe: () => () => {},
      refetch: async () => {},
      dispose: () => disposedNodes.push(request.nodeId),
    }))
    const bridge = createCoordinatorResolve({ coordinator, registry: fakeRegistry(), resolve: async () => 'v' })

    await bridge.resolve(binding('a'), { nodeId: 'a', variables: {}, reason: 'initial' })
    await bridge.resolve(binding('b'), { nodeId: 'b', variables: {}, reason: 'initial' })
    bridge.dispose()

    expect(disposedNodes.sort()).toEqual(['a', 'b'])
  })
})
