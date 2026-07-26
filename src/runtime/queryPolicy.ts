import type { QueryPolicy, QueryScopePolicy } from '../core/types'

/**
 * Applies a host's `QueryScopePolicy` ceiling to an AI-authored `QueryPolicy`
 * — never rejects, always returns a policy the host has already agreed to
 * run (docs/dataflow-and-server-state-direction.md: "runtime은 1초로 clamp").
 */
export function clampQueryPolicy(policy: QueryPolicy | undefined, scope: QueryScopePolicy | undefined): QueryPolicy | undefined {
  if (!policy) return policy

  const clamped: QueryPolicy = { ...policy }

  if (clamped.refresh) {
    if (scope?.allowPolling === false) {
      delete clamped.refresh
    } else {
      let ms = clamped.refresh.ms
      if (scope?.minIntervalMs !== undefined) ms = Math.max(ms, scope.minIntervalMs)
      if (scope?.maxIntervalMs !== undefined) ms = Math.min(ms, scope.maxIntervalMs)
      clamped.refresh = { ...clamped.refresh, ms }
    }
  }

  if (clamped.retry && scope?.maxRetries !== undefined) {
    clamped.retry = { ...clamped.retry, maxAttempts: Math.min(clamped.retry.maxAttempts, scope.maxRetries) }
  }

  return clamped
}
