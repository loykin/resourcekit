import { getValueAtPath } from './path'
import type { ConnectionAdapter, ConnectionPolicy, JsonSchema, RegisteredConnection } from './types'

/**
 * Built-in connection adapters. Only `rest` lives in core — like the plain
 * `restResolver` in resolvers.ts, the `datasourcekit` connection adapter
 * ships as a datasourcekit adapter package, never here.
 */

export interface RestConnectionConfig {
  baseUrl: string
  headers?: Record<string, string>
}

export interface RestConnectionRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | string[]>
  body?: unknown
  rowsPath?: string
}

function checkPolicy(connection: RegisteredConnection<RestConnectionConfig>, request: RestConnectionRequest, policy: ConnectionPolicy | undefined): string[] {
  const issues: string[] = []
  const method = request.method ?? 'GET'
  if (policy?.methods && !policy.methods.includes(method)) {
    issues.push(`method ${method} is not allowed for connection ${connection.uid}`)
  }
  if (policy?.pathPrefixes && !policy.pathPrefixes.some((prefix) => request.path.startsWith(prefix))) {
    issues.push(`path ${request.path} is not within an allowed prefix for connection ${connection.uid}`)
  }
  return issues
}

function buildUrl(config: RestConnectionConfig, request: RestConnectionRequest): string {
  // `new URL(request.path, config.baseUrl)` would be wrong whenever baseUrl has
  // its own path segment (e.g. "https://api.example.com/crm"): a leading-"/"
  // reference like "/customers" is an absolute-path reference per the URL
  // spec, so it *replaces* the base's path instead of appending to it,
  // silently dropping "/crm". String-concatenate first instead.
  const base = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl
  const path = request.path.startsWith('/') ? request.path : `/${request.path}`
  const url = new URL(base + path)
  for (const [key, value] of Object.entries(request.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item)
  }
  return url.toString()
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
    throw new Error('REST connection adapter expected rows to be an array of objects')
  }
  return value as Record<string, unknown>[]
}

async function fetchRows(
  connection: RegisteredConnection<RestConnectionConfig>,
  request: RestConnectionRequest,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>[]> {
  const response = await fetch(buildUrl(connection.config, request), {
    method: request.method ?? 'GET',
    headers: connection.config.headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    signal,
  })
  if (!response.ok) {
    throw new Error(`REST connection request failed: ${response.status} ${response.statusText}`)
  }
  const json: unknown = await response.json()
  if (request.rowsPath) return asRows(getValueAtPath(json, request.rowsPath))
  if (Array.isArray(json)) return asRows(json)
  const rows = getValueAtPath(json, 'rows')
  if (rows !== undefined) return asRows(rows)
  // A single-resource endpoint (e.g. GET /users/:id) returns the record
  // itself, not wrapped in an array or a "rows" property — treat it as one row.
  if (typeof json === 'object' && json !== null) return [json as Record<string, unknown>]
  throw new Error('REST connection adapter expected rows to be an array of objects, a { rows: [...] } object, or a single object')
}

function jsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'object') return typeof value
  return 'string'
}

/** Best-effort JSON Schema from a row sample — good enough for MCP preview inspection, not a full inference engine. */
function inferRowsSchema(rows: Record<string, unknown>[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  for (const [key, value] of Object.entries(rows[0] ?? {})) {
    properties[key] = { type: jsonType(value) }
  }
  return { type: 'object', properties }
}

const restRequestSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    method: { enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    path: { type: 'string' },
    query: { type: 'object' },
    body: {},
    rowsPath: { type: 'string' },
  },
}

export const restConnectionAdapter: ConnectionAdapter<RestConnectionConfig, RestConnectionRequest> = {
  type: 'rest',
  requestSchema: restRequestSchema,

  async test(connection, context) {
    // Any completed HTTP response — even a 404 at the bare base URL, which
    // many APIs (including this repo's demo one) don't serve anything at —
    // proves the connection is reachable. Only a network-level failure
    // (fetch throwing: DNS, connection refused, timeout, ...) means it isn't.
    const start = Date.now()
    try {
      const response = await fetch(connection.config.baseUrl, { method: 'GET', headers: connection.config.headers, signal: context.signal })
      return {
        ok: true,
        message: response.ok ? undefined : `reachable, but the base URL itself responded ${response.status} ${response.statusText}`,
        latencyMs: Date.now() - start,
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'connection test failed', latencyMs: Date.now() - start }
    }
  },

  async validate(connection, request) {
    const issues = checkPolicy(connection, request, connection.policy)
    return issues.length === 0 ? { valid: true } : { valid: false, issues }
  },

  async preview(connection, request, context) {
    const issues = checkPolicy(connection, request, connection.policy)
    if (issues.length > 0) throw new Error(issues.join('; '))

    const start = Date.now()
    const rows = await fetchRows(connection, request, context.signal)
    const maxRows = connection.mcpPolicy?.maxRows ?? 20
    const limited = rows.slice(0, maxRows)
    return {
      schema: inferRowsSchema(limited),
      rows: limited,
      stats: { returnedRows: limited.length, totalRows: rows.length, executionTimeMs: Date.now() - start },
      truncated: rows.length > limited.length,
    }
  },

  async resolve(connection, request, context) {
    const issues = checkPolicy(connection, request, connection.policy)
    if (issues.length > 0) throw new Error(issues.join('; '))
    return fetchRows(connection, request, context.signal)
  },
}
