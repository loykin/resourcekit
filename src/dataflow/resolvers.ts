import type { ConnectionBindingSpec, ConnectionManifest, DataResolver, RegisteredConnection, RestBindingSpec, StaticBindingSpec } from '../core/types'

/**
 * Built-in resolvers. Only `rest` and `static` live in core — the
 * `datasource` resolver ships as a datasourcekit adapter package, never here.
 */

export const staticResolver: DataResolver<StaticBindingSpec> = async (binding) => {
  return binding.spec.rows
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

export function createRestResolver(options: RestResolverOptions = {}): DataResolver<RestBindingSpec> {
  return async (binding, ctx) => {
    const spec = binding.spec
    const dynamicHeaders = options.headers ? await options.headers() : undefined
    const headers = dynamicHeaders || spec.headers ? { ...dynamicHeaders, ...spec.headers } : undefined
    const fetchImpl = options.fetchImpl ?? fetch
    const response = await fetchImpl(spec.url, {
      method: spec.method ?? 'GET',
      headers,
      body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      signal: ctx.signal,
    })

    if (!response.ok) {
      throw new Error(`REST resolver request failed: ${response.status} ${response.statusText}`)
    }

    const json: unknown = await response.json()
    if (spec.rowsPath) return asRows(getPath(json, spec.rowsPath))
    if (Array.isArray(json)) return asRows(json)
    const rows = getPath(json, 'rows')
    if (rows !== undefined) return asRows(rows)
    // A single-resource endpoint (e.g. GET /users/:id) returns the record
    // itself, not wrapped in an array or a "rows" property — treat it as one row.
    if (typeof json === 'object' && json !== null) return [json as Record<string, unknown>]
    throw new Error('REST resolver expected rows to be an array of objects, a { rows: [...] } object, or a single object')
  }
}

export const restResolver: DataResolver<RestBindingSpec> = createRestResolver()

/**
 * Bridges the `connection` DataBinding kind to a registered
 * `ConnectionManifest.resolve()` — the render path still goes through the
 * ordinary `registry.getDataSourceManifest()` dispatch, it just looks the
 * connection/manifest up first (test.md §5.2 decision: ConnectionManifest is
 * a separate contract, not a DataSourceManifest replacement).
 */
export function createConnectionDataResolver(registry: {
  getConnection(uid: string): Promise<RegisteredConnection | undefined>
  getConnectionManifest(apiVersion: string, kind: string): ConnectionManifest | undefined
}): DataResolver<ConnectionBindingSpec> {
  return async (binding, ctx) => {
    const spec = binding.spec
    const connection = await registry.getConnection(spec.connection)
    if (!connection) throw new Error(`Connection resolver: connection ${spec.connection} is not registered`)
    const manifest = registry.getConnectionManifest(connection.apiVersion, connection.kind)
    if (!manifest) throw new Error(`Connection resolver: no manifest registered for connection kind ${connection.kind}`)
    return manifest.resolve(connection, spec.request, ctx)
  }
}
