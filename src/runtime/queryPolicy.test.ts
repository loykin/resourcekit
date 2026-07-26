import { describe, expect, it } from 'vitest'
import { clampQueryPolicy } from './queryPolicy'

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
