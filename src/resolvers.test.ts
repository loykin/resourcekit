import { afterEach, describe, expect, it, vi } from 'vitest'
import { restResolver } from './resolvers'

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

  it('errors on non-2xx responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500, statusText: 'Server Error' }))

    await expect(restResolver({ source: 'rest', url: '/api/items' }, { variables: {} })).rejects.toThrow(
      'REST resolver request failed: 500 Server Error',
    )
  })
})
