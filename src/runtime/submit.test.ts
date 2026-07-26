import { describe, expect, it, vi } from 'vitest'
import { runSubmit, SUBMIT_CANCELLED } from './submit'
import type { SubmitRuntime } from './submit'
import type { VariableValue } from '../core/types'
import { createMemoryRuntimeStore } from './store'

function makeRuntime(overrides: Partial<SubmitRuntime> = {}): SubmitRuntime & { values: Map<string, VariableValue> } {
  const values = new Map<string, VariableValue>([['customerId', '7']])
  return {
    values,
    scope: 'test',
    getMutationResolver: () => async (_binding, payload) => ({ id: '7', echoed: payload, version: 'v2' }),
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

    await runSubmit(runtime, { action: 'customers.update', mutation: { target: 'memory' } }, { name: 'Ada' })

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
    const resolver = vi.fn(async () => ({ ok: true }))
    const runtime = makeRuntime({ getMutationResolver: () => resolver })

    await runSubmit(runtime, { mutation: { target: 'rest', url: '/api/customers/${customerId}', method: 'PUT' } }, { name: 'Ada' })

    expect(resolver).toHaveBeenCalledWith(
      { target: 'rest', url: '/api/customers/7', method: 'PUT' },
      { name: 'Ada' },
      { variables: { customerId: '7' } },
    )
  })

  it('resolves explicit payload references in mutation bindings and confirmation copy', async () => {
    const resolver = vi.fn(async () => ({ ok: true }))
    const confirm = vi.fn(async () => true)
    const runtime = makeRuntime({ getMutationResolver: () => resolver, confirm })

    await runSubmit(
      runtime,
      {
        mutation: { target: 'rest', url: '/api/customers/${payload.customer.id}', method: 'DELETE' },
        confirm: { title: 'Delete ${payload.customer.name}?', description: 'Tenant ${customerId}' },
      },
      { customer: { id: '9', name: 'Ada' } },
    )

    expect(confirm).toHaveBeenCalledWith({ title: 'Delete Ada?', description: 'Tenant 7' })
    expect(resolver).toHaveBeenCalledWith(
      { target: 'rest', url: '/api/customers/9', method: 'DELETE' },
      { customer: { id: '9', name: 'Ada' } },
      { variables: { customerId: '7' } },
    )
  })

  it('fails closed without a confirm handler and returns a cancellation sentinel without mutating', async () => {
    const resolver = vi.fn(async () => ({ ok: true }))
    await expect(
      runSubmit(makeRuntime({ getMutationResolver: () => resolver }), { mutation: { target: 'memory' }, confirm: { title: 'Proceed?' } }, {}),
    ).rejects.toThrow(/no confirm handler/)

    const cancelled = await runSubmit(
      makeRuntime({ getMutationResolver: () => resolver, confirm: async () => false }),
      { mutation: { target: 'memory' }, confirm: { title: 'Proceed?' } },
      {},
    )
    expect(cancelled).toBe(SUBMIT_CANCELLED)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('applies onSuccess setVariable effects from the result via dot-path', async () => {
    const runtime = makeRuntime()

    await runSubmit(
      runtime,
      {
        mutation: { target: 'memory' },
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
        mutation: { target: 'memory' },
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
        mutation: { target: 'memory' },
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
      runSubmit(runtime, { mutation: { target: 'rest', url: '/api/${missing}' } }, {}),
    ).rejects.toThrow(/unresolved references/)
  })

  it('rejects unresolved payload references before confirmation', async () => {
    const confirm = vi.fn(async () => true)
    await expect(
      runSubmit(
        makeRuntime({ confirm }),
        { mutation: { target: 'rest', url: '/api/${payload.id}' }, confirm: { title: 'Delete?' } },
        {},
      ),
    ).rejects.toThrow(/payload\.id/)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('rejects unregistered mutation targets', async () => {
    const runtime = makeRuntime({ getMutationResolver: () => undefined })
    await expect(runSubmit(runtime, { mutation: { target: 'nope' } }, {})).rejects.toThrow(/not registered/)
  })

  it('enforces the action allowlist when provided', async () => {
    const runtime = makeRuntime({ allowedActions: ['users.update'] })
    await expect(
      runSubmit(runtime, { action: 'users.delete', mutation: { target: 'memory' } }, {}),
    ).rejects.toThrow(/not allowed/)
    await expect(
      runSubmit(runtime, { action: 'users.update', mutation: { target: 'memory' } }, {}),
    ).resolves.toBeDefined()
  })
})
