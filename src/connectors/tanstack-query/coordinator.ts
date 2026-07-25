import { QueryObserver, keepPreviousData } from '@tanstack/query-core'
import type { QueryClient } from '@tanstack/query-core'
import type { QueryCoordinator, QueryHandle, QueryRequest } from '../../runtime/queryCoordinator'

/**
 * TanStack Query-backed `QueryCoordinator`
 * (docs/dataflow-and-server-state-direction.md P1 item 1) — actual caching,
 * polling, dedup, and retry, unlike `createDirectQueryCoordinator`'s one-shot
 * behavior. One `QueryObserver` per `open()` call; a nodeId -> observer set
 * mirrors `createDirectQueryCoordinator`'s `entriesByNodeId` for the same
 * reason: TanStack's own cache is keyed by query key, not nodeId, so
 * `invalidate`/`refetch` by nodeId still needs this side table.
 */
export function createTanStackQueryCoordinator(queryClient: QueryClient): QueryCoordinator {
  const observersByNodeId = new Map<string, Set<QueryObserver>>()

  return {
    open(request: QueryRequest): QueryHandle {
      const observer = new QueryObserver<unknown, Error, unknown, unknown, readonly unknown[]>(queryClient, {
        queryKey: request.key,
        queryFn: ({ signal }) => request.execute(signal),
        refetchInterval: request.policy?.refresh?.kind === 'interval' ? request.policy.refresh.ms : false,
        staleTime: request.policy?.staleForMs,
        retry: request.policy?.retry?.maxAttempts,
        placeholderData: request.policy?.retainPreviousData ? keepPreviousData : undefined,
      })

      const forNode = observersByNodeId.get(request.nodeId) ?? new Set<QueryObserver>()
      forNode.add(observer)
      observersByNodeId.set(request.nodeId, forNode)

      return {
        getSnapshot() {
          const result = observer.getCurrentResult()
          if (result.isPending) return { status: 'pending' }
          if (result.isError) return { status: 'error', error: result.error, value: result.data }
          return { status: 'ready', value: result.data }
        },
        subscribe: (listener) => observer.subscribe(() => listener()),
        async refetch() {
          await observer.refetch()
        },
        dispose() {
          observer.destroy()
          const forNode = observersByNodeId.get(request.nodeId)
          forNode?.delete(observer)
          if (forNode && forNode.size === 0) observersByNodeId.delete(request.nodeId)
        },
      }
    },
    async invalidate(nodeIds) {
      for (const nodeId of nodeIds) {
        for (const observer of observersByNodeId.get(nodeId) ?? []) {
          await queryClient.invalidateQueries({ queryKey: observer.options.queryKey, exact: true })
        }
      }
    },
    async refetch(nodeIds) {
      for (const nodeId of nodeIds) {
        for (const observer of observersByNodeId.get(nodeId) ?? []) await observer.refetch()
      }
    },
  }
}
