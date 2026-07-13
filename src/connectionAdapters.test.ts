import { afterEach, describe, expect, it, vi } from 'vitest'
import { restConnectionAdapter } from './connectionAdapters'
import type { RegisteredConnection } from './types'
import type { RestConnectionConfig, RestConnectionRequest } from './connectionAdapters'

function connection(overrides: Partial<RegisteredConnection<RestConnectionConfig>> = {}): RegisteredConnection<RestConnectionConfig> {
  return {
    uid: 'crm-api',
    type: 'rest',
    name: 'CRM API',
    config: { baseUrl: 'https://api.example.com/crm/' },
    policy: { methods: ['GET', 'PATCH'], pathPrefixes: ['/customers'] },
    ...overrides,
  }
}

describe('restConnectionAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves rows for a request within policy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ id: '1', name: 'Acme' }]), { status: 200 }))

    const rows = await restConnectionAdapter.resolve(connection(), { path: '/customers' }, { variables: {} })
    expect(rows).toEqual([{ id: '1', name: 'Acme' }])
  })

  it('preserves a path segment on baseUrl instead of an absolute-path request replacing it', async () => {
    // A leading "/" in request.path is an absolute-path reference per the URL
    // spec — naively passed as `new URL(path, baseUrl)`, it silently drops
    // any path baseUrl itself has (e.g. "/crm"). Covers both a trailing-slash
    // and no-trailing-slash baseUrl.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[]', { status: 200 }))

    await restConnectionAdapter.resolve(connection({ config: { baseUrl: 'https://api.example.com/crm/' } }), { path: '/customers' }, { variables: {} })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/crm/customers')

    fetchMock.mockClear()
    await restConnectionAdapter.resolve(connection({ config: { baseUrl: 'https://api.example.com/crm' } }), { path: '/customers' }, { variables: {} })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/crm/customers')
  })

  it('wraps a single-resource response (e.g. GET /users/:id) as one row', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: '1', name: 'Alice' }), { status: 200 }))

    const rows = await restConnectionAdapter.resolve(connection(), { path: '/customers/1' }, { variables: {} })
    expect(rows).toEqual([{ id: '1', name: 'Alice' }])
  })

  it('rejects a request outside the connection policy without calling fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(restConnectionAdapter.resolve(connection(), { path: '/customers', method: 'DELETE' }, { variables: {} })).rejects.toThrow(
      /method DELETE is not allowed/,
    )
    await expect(restConnectionAdapter.resolve(connection(), { path: '/settings' }, { variables: {} })).rejects.toThrow(/not within an allowed prefix/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validate() reports the same policy issues resolve() would enforce', async () => {
    await expect(restConnectionAdapter.validate?.(connection(), { path: '/customers' }, {})).resolves.toEqual({ valid: true })
    await expect(restConnectionAdapter.validate?.(connection(), { path: '/customers', method: 'DELETE' }, {})).resolves.toMatchObject({
      valid: false,
      issues: [expect.stringMatching(/method DELETE is not allowed/)],
    })
  })

  it('test() reports reachability, not whether the bare base URL itself is a valid route', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
    await expect(restConnectionAdapter.test?.(connection(), {})).resolves.toMatchObject({ ok: true, message: undefined })

    // A 404 at the base URL (common for APIs with no route at "/") still proves the server answered.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404, statusText: 'Not Found' }))
    await expect(restConnectionAdapter.test?.(connection(), {})).resolves.toMatchObject({ ok: true, message: expect.stringContaining('404') })

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    await expect(restConnectionAdapter.test?.(connection(), {})).resolves.toMatchObject({ ok: false, message: 'network down' })
  })

  it('preview() truncates to mcpPolicy.maxRows and shares resolve()s fetch call (test.md §7)', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({ id: String(index) }))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(rows), { status: 200 }))

    const request: RestConnectionRequest = { path: '/customers' }
    const previewConnection = connection({ mcpPolicy: { maxRows: 2 } })
    const preview = await restConnectionAdapter.preview?.(previewConnection, request, {})

    expect(preview).toMatchObject({ rows: [{ id: '0' }, { id: '1' }], truncated: true, stats: { returnedRows: 2, totalRows: 5 } })

    const previewCallUrl = fetchMock.mock.calls[0]?.[0]
    fetchMock.mockClear()

    await restConnectionAdapter.resolve(previewConnection, request, { variables: {} })
    const resolveCallUrl = fetchMock.mock.calls[0]?.[0]

    expect(resolveCallUrl).toEqual(previewCallUrl)
  })
})
