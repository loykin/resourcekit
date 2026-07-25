import { QueryClient, environmentManager } from '@tanstack/query-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryCoordinator, QueryHandle, QueryRequest, QuerySnapshot } from '../../runtime/queryCoordinator'
import { createTanStackQueryCoordinator } from './coordinator'

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
}

/**
 * Opens a handle and keeps exactly one persistent no-op subscriber alive for
 * the rest of the test. `QueryObserver` only (re-)triggers its mount fetch
 * when its listener count goes 0 -> 1 (see `onSubscribe()`), so a test
 * pattern that repeatedly subscribes-then-unsubscribes (e.g. calling a naive
 * per-assertion waitFor with no standing subscriber) can retrigger an
 * unwanted extra fetch every time it drops to zero listeners in between.
 * Assertions that need to wait for a snapshot condition add a second,
 * short-lived listener on top of this one via `waitForSnapshot`.
 */
function openTracked(coordinator: QueryCoordinator, request: QueryRequest): QueryHandle {
  const handle = coordinator.open(request)
  handle.subscribe(() => {})
  return handle
}

function waitForSnapshot(handle: QueryHandle, predicate: (snapshot: QuerySnapshot) => boolean): Promise<void> {
  if (predicate(handle.getSnapshot())) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = handle.subscribe(() => {
      if (!predicate(handle.getSnapshot())) return
      unsubscribe()
      resolve()
    })
  })
}

describe('createTanStackQueryCoordinator', () => {
  it('resolves with the value execute() produces', async () => {
    const coordinator = createTanStackQueryCoordinator(freshClient())
    const handle = openTracked(coordinator, { nodeId: 'processes', key: ['processes'], execute: async () => [{ id: '1' }] })

    await waitForSnapshot(handle, (s) => s.status === 'ready')
    expect(handle.getSnapshot()).toEqual({ status: 'ready', value: [{ id: '1' }] })
  })

  it('reports error status when execute rejects', async () => {
    const coordinator = createTanStackQueryCoordinator(freshClient())
    const handle = openTracked(coordinator, {
      nodeId: 'processes',
      key: ['processes'],
      execute: async () => {
        throw new Error('boom')
      },
    })

    await waitForSnapshot(handle, (s) => s.status !== 'pending')
    expect(handle.getSnapshot().status).toBe('error')
    expect((handle.getSnapshot().error as Error).message).toBe('boom')
  })

  describe('polling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      // `refetchInterval` is a no-op under TanStack's own `isServer` check
      // (`typeof window === 'undefined'`), which is true in this project's
      // Node test environment — override it so polling is actually
      // schedulable here, matching real browser behavior.
      environmentManager.setIsServer(() => false)
    })
    afterEach(() => {
      vi.useRealTimers()
      environmentManager.setIsServer(() => typeof window === 'undefined')
    })

    it('refetches on the configured interval and not before', async () => {
      const execute = vi.fn(async () => 'value')
      const coordinator = createTanStackQueryCoordinator(freshClient())
      openTracked(coordinator, { nodeId: 'n', key: ['n'], execute, policy: { refresh: { kind: 'interval', ms: 1000 } } })

      await vi.advanceTimersByTimeAsync(0) // flush the mount-triggered initial fetch
      expect(execute).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(999)
      expect(execute).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(2) // past the 1000ms mark, tolerating scheduling boundary rounding
      expect(execute).toHaveBeenCalledTimes(2)
    })
  })

  it('invalidate(nodeIds) marks matching cache entries stale without re-running them', async () => {
    const execute = vi.fn(async () => 'first')
    const client = freshClient()
    const coordinator = createTanStackQueryCoordinator(client)
    const handle = openTracked(coordinator, { nodeId: 'a', key: ['a'], execute })
    const other = openTracked(coordinator, { nodeId: 'b', key: ['b'], execute: async () => 'b1' })

    await waitForSnapshot(handle, (s) => s.status === 'ready')
    expect(handle.getSnapshot().value).toBe('first')

    await coordinator.invalidate(['a'])

    expect(execute).toHaveBeenCalledTimes(1)
    expect(client.getQueryState(['a'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['b'])?.isInvalidated).toBe(false)
    expect(other.getSnapshot().value).toBe('b1')
  })

  it('refetch(nodeIds) forces a re-run regardless of staleness', async () => {
    const execute = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    const coordinator = createTanStackQueryCoordinator(freshClient())
    // Long staleTime — only an explicit refetch(), not staleness, should trigger the second run.
    const handle = openTracked(coordinator, { nodeId: 'a', key: ['a'], execute, policy: { staleForMs: 60_000 } })

    await waitForSnapshot(handle, (s) => s.status === 'ready')

    const done = waitForSnapshot(handle, (s) => s.value === 'second')
    await coordinator.refetch(['a'])
    await done

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('dedupes two opens sharing the same key to a single underlying execute', async () => {
    const execute = vi.fn(async () => 'shared')
    const coordinator = createTanStackQueryCoordinator(freshClient())
    const handleA = openTracked(coordinator, { nodeId: 'a', key: ['shared'], execute })
    const handleB = openTracked(coordinator, { nodeId: 'b', key: ['shared'], execute })

    await waitForSnapshot(handleA, (s) => s.status === 'ready')
    await waitForSnapshot(handleB, (s) => s.status === 'ready')

    expect(execute).toHaveBeenCalledTimes(1)
    expect(handleA.getSnapshot().value).toBe('shared')
    expect(handleB.getSnapshot().value).toBe('shared')
  })

  it('dispose() removes the observer from nodeId tracking so a later invalidate/refetch is a no-op for it', async () => {
    const execute = vi.fn(async () => 'value')
    const coordinator = createTanStackQueryCoordinator(freshClient())
    const handle = openTracked(coordinator, { nodeId: 'n', key: ['n'], execute })

    await waitForSnapshot(handle, (s) => s.status === 'ready')
    handle.dispose()
    execute.mockClear()

    await coordinator.invalidate(['n'])
    await coordinator.refetch(['n'])

    expect(execute).not.toHaveBeenCalled()
  })

  it('maps policy.retry.maxAttempts to the observer retry count', async () => {
    let attempts = 0
    const execute = vi.fn(async () => {
      attempts++
      if (attempts <= 2) throw new Error(`attempt ${attempts} failed`)
      return 'eventually'
    })
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } } })
    const coordinator = createTanStackQueryCoordinator(client)
    const handle = openTracked(coordinator, { nodeId: 'n', key: ['n'], execute, policy: { retry: { maxAttempts: 2 } } })

    await waitForSnapshot(handle, (s) => s.status !== 'pending')

    expect(handle.getSnapshot()).toEqual({ status: 'ready', value: 'eventually' })
    expect(execute).toHaveBeenCalledTimes(3) // 1 initial attempt + 2 retries
  })
})
