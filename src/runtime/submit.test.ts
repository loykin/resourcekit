import { describe, expect, it, vi } from 'vitest'
import { runSubmit, SUBMIT_CANCELLED } from './submit'
import type { SubmitRuntime } from './submit'
import type { MutationResolver, MutationSourceManifest, VariableValue } from '../core/types'
import { createMemoryRuntimeStore } from './store'

const API_VERSION = 'resourcekit.dev/v1alpha1'

function mutation(kind: string, spec: unknown = {}) {
  return { apiVersion: API_VERSION, kind, spec }
}

function manifestFor(kind: string, resolve: MutationResolver): MutationSourceManifest {
  return { apiVersion: API_VERSION, kind, resolve }
}

function makeRuntime(overrides: Partial<SubmitRuntime> = {}): SubmitRuntime & { values: Map<string, VariableValue> } {
  const values = new Map<string, VariableValue>([['customerId', '7']])
  return {
    values,
    scope: 'test',
    getMutationSourceManifest: () => manifestFor('memory', async (_binding, payload) => ({ id: '7', echoed: payload, version: 'v2' })),
    variables: {
      snapshot: () => Object.fromEntries(values.entries()),
      set: (name, value) => {
        if (value === undefined) values.delete(name)
        else values.set(name, value)
      },
    },
    store: createMemoryRuntimeStore(),
    dataflow: {
      invalidate: vi.fn(),
      refetch: vi.fn(async () => undefined),
    },
    ...overrides,
  }
}

describe('runSubmit', () => {
  it('publishes named execution pending and ready snapshots through the common store', async () => {
    const store = createMemoryRuntimeStore()
    const publish = vi.spyOn(store, 'publish')
    const runtime = makeRuntime({ store })

    await runSubmit(runtime, { action: 'customers.update', mutation: mutation('memory') }, { name: 'Ada' })

    expect(publish).toHaveBeenNthCalledWith(
      1,
      { scope: 'test', namespace: 'execution', name: 'customers.update' },
      { status: 'pending' },
    )
    expect(publish).toHaveBeenNthCalledWith(
      2,
      { scope: 'test', namespace: 'execution', name: 'customers.update' },
      {
        status: 'ready',
        value: { id: '7', echoed: { name: 'Ada' }, version: 'v2' },
      },
    )
  })

  it('interpolates the mutation binding and dispatches to the resolver', async () => {
    const resolve = vi.fn(async () => ({ ok: true }))
    const runtime = makeRuntime({ getMutationSourceManifest: () => manifestFor('rest', resolve) })

    await runSubmit(runtime, { mutation: mutation('rest', { url: '/api/customers/${customerId}', method: 'PUT' }) }, { name: 'Ada' })

    expect(resolve).toHaveBeenCalledWith(
      mutation('rest', { url: '/api/customers/7', method: 'PUT' }),
      { name: 'Ada' },
      { variables: { customerId: '7' } },
    )
  })

  it('resolves explicit payload references in mutation bindings and confirmation copy', async () => {
    const resolve = vi.fn(async () => ({ ok: true }))
    const confirm = vi.fn(async () => true)
    const runtime = makeRuntime({ getMutationSourceManifest: () => manifestFor('rest', resolve), confirm })

    await runSubmit(
      runtime,
      {
        mutation: mutation('rest', { url: '/api/customers/${payload.customer.id}', method: 'DELETE' }),
        confirm: { title: 'Delete ${payload.customer.name}?', description: 'Tenant ${customerId}' },
      },
      { customer: { id: '9', name: 'Ada' } },
    )

    expect(confirm).toHaveBeenCalledWith({ title: 'Delete Ada?', description: 'Tenant 7' })
    expect(resolve).toHaveBeenCalledWith(
      mutation('rest', { url: '/api/customers/9', method: 'DELETE' }),
      { customer: { id: '9', name: 'Ada' } },
      { variables: { customerId: '7' } },
    )
  })

  it('fails closed without a confirm handler and returns a cancellation sentinel without mutating', async () => {
    const resolve = vi.fn(async () => ({ ok: true }))
    await expect(
      runSubmit(
        makeRuntime({ getMutationSourceManifest: () => manifestFor('memory', resolve) }),
        { mutation: mutation('memory'), confirm: { title: 'Proceed?' } },
        {},
      ),
    ).rejects.toThrow(/no confirm handler/)

    const cancelled = await runSubmit(
      makeRuntime({ getMutationSourceManifest: () => manifestFor('memory', resolve), confirm: async () => false }),
      { mutation: mutation('memory'), confirm: { title: 'Proceed?' } },
      {},
    )
    expect(cancelled).toBe(SUBMIT_CANCELLED)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('applies onSuccess setVariable effects from the result via dot-path', async () => {
    const runtime = makeRuntime()

    await runSubmit(
      runtime,
      {
        mutation: mutation('memory'),
        onSuccess: [{ kind: 'setVariable', variable: 'usersVersion', from: 'version' }],
      },
      {},
    )

    expect(runtime.values.get('usersVersion')).toBe('v2')
  })

  it('supports literal setVariable, clear, and emit effects', async () => {
    const emitted: Array<[string, unknown]> = []
    const runtime = makeRuntime({ emit: (event, payload) => void emitted.push([event, payload]) })
    runtime.values.set('createOpen', '1')

    await runSubmit(
      runtime,
      {
        mutation: mutation('memory'),
        onSuccess: [
          { kind: 'setVariable', variable: 'mode', value: 'done' },
          { kind: 'setVariable', variable: 'createOpen' },
          { kind: 'emit', event: 'users.created' },
        ],
      },
      {},
    )

    expect(runtime.values.get('mode')).toBe('done')
    expect(runtime.values.get('createOpen')).toBeUndefined()
    expect(emitted).toHaveLength(1)
    expect(emitted[0][0]).toBe('users.created')
  })

  it('delegates invalidateData/refetchData effects directly to the dataflow engine', async () => {
    const dataflow = {
      invalidate: vi.fn(),
      refetch: vi.fn(async () => undefined),
    }
    const runtime = makeRuntime({ dataflow })

    await runSubmit(
      runtime,
      {
        mutation: mutation('memory'),
        onSuccess: [
          { kind: 'invalidateData', dataflow: ['customers', 'customerDetail'] },
          { kind: 'refetchData', dataflow: ['customers'] },
        ],
      },
      {},
    )

    expect(dataflow.invalidate).toHaveBeenCalledWith(['customers', 'customerDetail'])
    expect(dataflow.refetch).toHaveBeenCalledWith(['customers'])
  })

  it('rejects unresolved variables in the binding', async () => {
    const runtime = makeRuntime()
    await expect(
      runSubmit(runtime, { mutation: mutation('rest', { url: '/api/${missing}' }) }, {}),
    ).rejects.toThrow(/unresolved references/)
  })

  it('rejects unresolved payload references before confirmation', async () => {
    const confirm = vi.fn(async () => true)
    await expect(
      runSubmit(
        makeRuntime({ confirm }),
        { mutation: mutation('rest', { url: '/api/${payload.id}' }), confirm: { title: 'Delete?' } },
        {},
      ),
    ).rejects.toThrow(/payload\.id/)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('rejects unregistered mutation targets', async () => {
    const runtime = makeRuntime({ getMutationSourceManifest: () => undefined })
    await expect(runSubmit(runtime, { mutation: mutation('nope') }, {})).rejects.toThrow(/not registered/)
  })

  it('enforces the action allowlist when provided', async () => {
    const runtime = makeRuntime({ allowedActions: ['users.update'] })
    await expect(
      runSubmit(runtime, { action: 'users.delete', mutation: mutation('memory') }, {}),
    ).rejects.toThrow(/not allowed/)
    await expect(
      runSubmit(runtime, { action: 'users.update', mutation: mutation('memory') }, {}),
    ).resolves.toBeDefined()
  })
})
