import { describe, expect, it, vi } from 'vitest'
import { runSubmit, SUBMIT_CANCELLED } from './submit'
import type { SubmitRuntime } from './submit'
import type { VariableValue } from './types'

function makeRuntime(overrides: Partial<SubmitRuntime> = {}): SubmitRuntime & { values: Map<string, VariableValue> } {
  const values = new Map<string, VariableValue>([['customerId', '7']])
  return {
    values,
    getMutationResolver: () => async (_binding, payload) => ({ id: '7', echoed: payload, version: 'v2' }),
    variables: {
      snapshot: () => Object.fromEntries(values.entries()),
      set: (name, value) => void values.set(name, value),
    },
    ...overrides,
  }
}

describe('runSubmit', () => {
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

  it('applies setData/invalidateData/refetchData effects through runtime.dataflow', async () => {
    const setState = vi.fn(async () => undefined)
    const invalidate = vi.fn(async () => undefined)
    const refetch = vi.fn(async () => undefined)
    const runtime = makeRuntime({ dataflow: { setState, invalidate, refetch } })

    await runSubmit(
      runtime,
      {
        mutation: { target: 'memory' },
        onSuccess: [
          { kind: 'setData', node: 'selectedCustomer', from: 'id' },
          { kind: 'invalidateData', nodes: ['customers', 'customerDetail'] },
          { kind: 'refetchData', nodes: ['customers'] },
        ],
      },
      {},
    )

    expect(setState).toHaveBeenCalledWith('selectedCustomer', '7')
    expect(invalidate).toHaveBeenCalledWith(['customers', 'customerDetail'])
    expect(refetch).toHaveBeenCalledWith(['customers'])
  })

  it('setData falls back to the whole mutation result when no from/value is given', async () => {
    const setState = vi.fn(async () => undefined)
    const runtime = makeRuntime({ dataflow: { setState, invalidate: vi.fn(), refetch: vi.fn() } })

    await runSubmit(runtime, { mutation: { target: 'memory' }, onSuccess: [{ kind: 'setData', node: 'lastResult' }] }, {})

    expect(setState).toHaveBeenCalledWith('lastResult', { id: '7', echoed: {}, version: 'v2' })
  })

  it('rejects data effects when the document has no data graph', async () => {
    const runtime = makeRuntime()
    await expect(
      runSubmit(runtime, { mutation: { target: 'memory' }, onSuccess: [{ kind: 'invalidateData', nodes: ['x'] }] }, {}),
    ).rejects.toThrow(/data graph/)
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
