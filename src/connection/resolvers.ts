import type { ConnectionAdapter, ConnectionBinding, DataResolver, RegisteredConnection, RestBinding, StaticBinding } from '../core/types'

/**
 * Built-in resolvers. Only `rest` and `static` live in core — the
 * `datasource` resolver ships as a datasourcekit adapter package, never here.
 */

export const staticResolver: DataResolver = async (binding) => {
  return (binding as StaticBinding).rows
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (typeof current !== 'object' || current === null) return undefined
    return (current as Record<string, unknown>)[part]
  }, value)
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
    throw new Error('REST resolver expected rows to be an array of objects')
  }
  return value as Record<string, unknown>[]
}

export interface RestResolverOptions {
  /**
   * Called before each request; merged under the binding's static `headers`
   * (binding headers win on conflict). Lets a host supply rotating/session
   * auth (a JWT refreshed out-of-band, e.g.) that a `RestBinding` can't hold
   * statically without going stale (provisr-poc-findings.md #7).
   */
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  fetchImpl?: typeof fetch
}

export function createRestResolver(options: RestResolverOptions = {}): DataResolver {
  return async (binding, ctx) => {
    const b = binding as RestBinding
    const dynamicHeaders = options.headers ? await options.headers() : undefined
    const headers = dynamicHeaders || b.headers ? { ...dynamicHeaders, ...b.headers } : undefined
    const fetchImpl = options.fetchImpl ?? fetch
    const response = await fetchImpl(b.url, {
      method: b.method ?? 'GET',
      headers,
      body: b.body === undefined ? undefined : JSON.stringify(b.body),
      signal: ctx.signal,
    })

    if (!response.ok) {
      throw new Error(`REST resolver request failed: ${response.status} ${response.statusText}`)
    }

    const json: unknown = await response.json()
    if (b.rowsPath) return asRows(getPath(json, b.rowsPath))
    if (Array.isArray(json)) return asRows(json)
    const rows = getPath(json, 'rows')
    if (rows !== undefined) return asRows(rows)
    // A single-resource endpoint (e.g. GET /users/:id) returns the record
    // itself, not wrapped in an array or a "rows" property — treat it as one row.
    if (typeof json === 'object' && json !== null) return [json as Record<string, unknown>]
    throw new Error('REST resolver expected rows to be an array of objects, a { rows: [...] } object, or a single object')
  }
}

export const restResolver: DataResolver = createRestResolver()

/**
 * Bridges the `connection` DataBinding source to a registered
 * `ConnectionAdapter.resolve()` — the render path still goes through the
 * ordinary `registry.getDataResolver()` dispatch, it just looks the
 * connection/adapter up first (test.md §5.2 decision: ConnectionAdapter is
 * a separate contract, not a DataResolver replacement).
 */
export function createConnectionDataResolver(registry: {
  getConnection(uid: string): Promise<RegisteredConnection | undefined>
  getConnectionAdapter(type: string): ConnectionAdapter | undefined
}): DataResolver {
  return async (binding, ctx) => {
    const b = binding as ConnectionBinding
    const connection = await registry.getConnection(b.connection)
    if (!connection) throw new Error(`Connection resolver: connection ${b.connection} is not registered`)
    const adapter = registry.getConnectionAdapter(connection.type)
    if (!adapter) throw new Error(`Connection resolver: no adapter registered for connection type ${connection.type}`)
    return adapter.resolve(connection, b.request, ctx)
  }
}
