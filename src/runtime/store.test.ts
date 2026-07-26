import { describe, expect, it, vi } from 'vitest'
import { createMemoryRuntimeStore, runtimeKeys } from './store'

describe('createMemoryRuntimeStore', () => {
  it('publishes every namespace through one revisioned KV watch plane', () => {
    const store = createMemoryRuntimeStore()
    const variables = vi.fn()
    const selected = vi.fn()
    store.subscribe({ kind: 'namespace', namespace: 'variable' }, variables)
    store.subscribe({ kind: 'key', key: runtimeKeys.objectState('selected') }, selected)

    const variable = store.publish(runtimeKeys.variable('region'), { status: 'ready', value: 'ap-northeast-2' })
    const data = store.publish(runtimeKeys.objectState('selected'), { status: 'ready', value: 'pipeline-7', epoch: 1 })

    expect(variable.revision).toBe(1)
    expect(data.revision).toBe(2)
    expect(variables).toHaveBeenCalledTimes(1)
    expect(selected).toHaveBeenCalledTimes(1)
    expect(store.read(runtimeKeys.objectState('selected'))?.value).toBe('pipeline-7')
  })

  it('lets extensions add namespaces without changing the store', () => {
    const store = createMemoryRuntimeStore()
    const listener = vi.fn()
    store.subscribe({ kind: 'namespace', namespace: 'plugin.audit' }, listener)

    store.publish(
      { scope: 'document', namespace: 'plugin.audit', name: 'entry' },
      { status: 'ready', value: { action: 'save' } },
    )

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ key: { scope: 'document', namespace: 'plugin.audit', name: 'entry' } }),
    )
  })

  it('carries an optional writer origin through subscriptions without storing it in the snapshot', () => {
    const store = createMemoryRuntimeStore()
    const listener = vi.fn()
    const key = runtimeKeys.objectState('selected')
    store.subscribe({ kind: 'key', key }, listener)

    store.publish(key, { status: 'ready', value: 'a' }, { origin: 'host' })

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ origin: 'host' }))
    expect(store.read(key)).not.toHaveProperty('origin')
  })
})
