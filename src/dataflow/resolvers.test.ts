import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectionDataResolver, createRestResolver, restResolver } from './resolvers'
import type { ConnectionManifest, RegisteredConnection } from '../core/types'

const API_VERSION = 'resourcekit.dev/v1alpha1'

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
        { apiVersion: API_VERSION, kind: 'rest', spec: { url: '/api/items', method: 'POST', body: { q: 'x' }, rowsPath: 'data.items' } },
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

    await expect(
      restResolver({ apiVersion: API_VERSION, kind: 'rest', spec: { url: '/api/users/1' } }, { variables: {} }),
    ).resolves.toEqual([{ id: '1', name: 'Alice' }])
  })

  it('errors on non-2xx responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500, statusText: 'Server Error' }))

    await expect(
      restResolver({ apiVersion: API_VERSION, kind: 'rest', spec: { url: '/api/items' } }, { variables: {} }),
    ).rejects.toThrow('REST resolver request failed: 500 Server Error')
  })
})

describe('createRestResolver', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges dynamic headers under the binding\'s static headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: '1' }]), { status: 200 }))
    const resolver = createRestResolver({
      headers: () => ({ Authorization: 'Bearer rotating-token', 'X-Trace': 'dynamic' }),
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    await resolver({ apiVersion: API_VERSION, kind: 'rest', spec: { url: '/api/items', headers: { 'X-Trace': 'static' } } }, { variables: {} })

    expect(fetchMock).toHaveBeenCalledWith('/api/items', {
      method: 'GET',
      headers: { Authorization: 'Bearer rotating-token', 'X-Trace': 'static' },
      body: undefined,
      signal: undefined,
    })
  })

  it('supports an async headers provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: '1' }]), { status: 200 }))
    const resolver = createRestResolver({
      headers: async () => ({ Authorization: 'Bearer async-token' }),
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    await resolver({ apiVersion: API_VERSION, kind: 'rest', spec: { url: '/api/items' } }, { variables: {} })

    expect(fetchMock).toHaveBeenCalledWith('/api/items', expect.objectContaining({ headers: { Authorization: 'Bearer async-token' } }))
  })
})

describe('createConnectionDataResolver', () => {
  it('looks up the connection and its manifest, then delegates resolve()', async () => {
    const connection: RegisteredConnection = { uid: 'crm-api', apiVersion: API_VERSION, kind: 'rest', name: 'CRM API', config: { baseUrl: 'https://x' } }
    const resolve = vi.fn().mockResolvedValue([{ id: '1' }])
    const manifest: ConnectionManifest = { apiVersion: API_VERSION, kind: 'rest', requestSchema: { type: 'object' }, resolve }
    const registry = {
      getConnection: async (uid: string) => (uid === 'crm-api' ? connection : undefined),
      getConnectionManifest: (apiVersion: string, kind: string) => (apiVersion === API_VERSION && kind === 'rest' ? manifest : undefined),
    }

    const resolver = createConnectionDataResolver(registry)
    const ctx = { variables: {} }
    await expect(
      resolver({ apiVersion: API_VERSION, kind: 'connection', spec: { connection: 'crm-api', request: { path: '/customers' } } }, ctx),
    ).resolves.toEqual([{ id: '1' }])
    expect(resolve).toHaveBeenCalledWith(connection, { path: '/customers' }, ctx)
  })

  it('throws when the connection or its manifest is not registered', async () => {
    const registry = { getConnection: async () => undefined, getConnectionManifest: () => undefined }
    const resolver = createConnectionDataResolver(registry)
    await expect(
      resolver({ apiVersion: API_VERSION, kind: 'connection', spec: { connection: 'missing', request: {} } }, { variables: {} }),
    ).rejects.toThrow(/not registered/)
  })
})
