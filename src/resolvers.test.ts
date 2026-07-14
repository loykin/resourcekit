import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectionDataResolver, restResolver } from './resolvers'
import type { ConnectionAdapter, RegisteredConnection } from './types'

describe('restResolver', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches JSON rows from a rowsPath', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { items: [{ id: '1' }] } }), {
        status: 200,
        statusText: 'OK',
      }),
    )

    await expect(
      restResolver(
        { source: 'rest', url: '/api/items', method: 'POST', body: { q: 'x' }, rowsPath: 'data.items' },
        { variables: {} },
      ),
    ).resolves.toEqual([{ id: '1' }])

    expect(fetchMock).toHaveBeenCalledWith('/api/items', {
      method: 'POST',
      headers: undefined,
      body: JSON.stringify({ q: 'x' }),
      signal: undefined,
    })
  })

  it('wraps a single-resource response (e.g. GET /users/:id) as one row', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: '1', name: 'Alice' }), { status: 200 }))

    await expect(restResolver({ source: 'rest', url: '/api/users/1' }, { variables: {} })).resolves.toEqual([{ id: '1', name: 'Alice' }])
  })

  it('errors on non-2xx responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500, statusText: 'Server Error' }))

    await expect(restResolver({ source: 'rest', url: '/api/items' }, { variables: {} })).rejects.toThrow(
      'REST resolver request failed: 500 Server Error',
    )
  })
})

describe('createConnectionDataResolver', () => {
  it('looks up the connection and its adapter, then delegates resolve()', async () => {
    const connection: RegisteredConnection = { uid: 'crm-api', type: 'rest', name: 'CRM API', config: { baseUrl: 'https://x' } }
    const resolve = vi.fn().mockResolvedValue([{ id: '1' }])
    const adapter: ConnectionAdapter = { type: 'rest', requestSchema: { type: 'object' }, resolve }
    const registry = {
      getConnection: async (uid: string) => (uid === 'crm-api' ? connection : undefined),
      getConnectionAdapter: (type: string) => (type === 'rest' ? adapter : undefined),
    }

    const resolver = createConnectionDataResolver(registry)
    const ctx = { variables: {} }
    await expect(resolver({ source: 'connection', connection: 'crm-api', request: { path: '/customers' } }, ctx)).resolves.toEqual([{ id: '1' }])
    expect(resolve).toHaveBeenCalledWith(connection, { path: '/customers' }, ctx)
  })

  it('throws when the connection or its adapter is not registered', async () => {
    const registry = { getConnection: async () => undefined, getConnectionAdapter: () => undefined }
    const resolver = createConnectionDataResolver(registry)
    await expect(resolver({ source: 'connection', connection: 'missing', request: {} }, { variables: {} })).rejects.toThrow(/not registered/)
  })
})
