import { describe, expect, it, vi } from 'vitest'
import { createDataflowRuntime } from './dataflow'
import type { DataBinding } from '../core/types'
import { createDirectQueryCoordinator, type QueryHandle, type QuerySnapshot } from './queryCoordinator'

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

describe('QueryCoordinator + DataflowRuntime integration (P0 vertical slice)', () => {
  it('a coordinator refetch reaches downstream resolve nodes through DataflowRuntime.publish', async () => {
    // "processes" starts through the runtime's own options.resolve (the
    // initial evaluation at start()); a later background refresh instead
    // goes through the coordinator and is folded back in via publish() —
    // proving the two layers actually compose, not just typecheck together.
    let backend = [{ id: '1' }]
    const coordinator = createDirectQueryCoordinator()

    const runtime = createDataflowRuntime({
      graph: {
        nodes: {
          processes: { kind: 'resolve', binding: { source: 'poll' } },
          count: { kind: 'resolve', binding: { source: 'test', rows: { $data: 'processes' } } },
        },
      },
      resolve: async (binding) => {
        const b = binding as DataBinding & { rows?: unknown[] }
        return b.source === 'poll' ? backend : (b.rows ?? []).length
      },
    })

    await runtime.start()
    expect(await runtime.resolve('count')).toBe(1)

    backend = [{ id: '1' }, { id: '2' }, { id: '3' }]
    const handle = coordinator.open({
      nodeId: 'processes',
      key: ['processes'],
      execute: async () => backend,
    })

    await waitFor(handle, (s) => s.status === 'ready')
    await runtime.publish('processes', { status: 'ready', value: handle.getSnapshot().value })

    expect(await runtime.resolve('processes')).toEqual(backend)
    expect(await runtime.resolve('count')).toBe(3)

    handle.dispose()
  })
})
