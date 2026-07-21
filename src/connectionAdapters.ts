import { getValueAtPath } from './path'
import type { ConnectionAdapter, ConnectionMcpPolicy, ConnectionPolicy, JsonSchema, RegisteredConnection } from './types'

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

// `new URL(request.path, config.baseUrl)` would be wrong whenever baseUrl has
// its own path segment (e.g. "https://api.example.com/crm"): a leading-"/"
// reference like "/customers" is an absolute-path reference per the URL
// spec, so it *replaces* the base's path instead of appending to it,
// silently dropping "/crm". String-concatenate first instead.
function joinUrl(baseUrl: string, path: string): URL {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return new URL(base + normalizedPath)
}

/**
 * `pathname` after the same WHATWG URL parsing `joinUrl`/`fetch` itself
 * apply — resolves `.`/`..` segments (including a percent-encoded `%2e%2e`)
 * and treats `\` as a path separator the way the URL spec does for
 * http(s). Checking the *canonical* pathname instead of the raw request
 * string is what closes those as `pathPrefixes` bypasses: whatever the
 * parser would resolve the request to is exactly what gets compared against
 * the (identically parsed) allowed prefix, so the check can't disagree with
 * the request actually sent.
 */
function canonicalPathname(baseUrl: string, path: string): string {
  return joinUrl(baseUrl, path).pathname
}

/** True only if every segment of `prefix` matches the corresponding leading segment of `path`'s canonical pathname — a boundary-aware, traversal-proof replacement for `path.startsWith(prefix)`. */
function matchesPathPrefix(baseUrl: string, path: string, prefix: string): boolean {
  const pathSegments = canonicalPathname(baseUrl, path).split('/').filter(Boolean)
  const prefixSegments = canonicalPathname(baseUrl, prefix).split('/').filter(Boolean)
  if (prefixSegments.length > pathSegments.length) return false
  return prefixSegments.every((segment, index) => segment === pathSegments[index])
}

function checkPolicy(connection: RegisteredConnection<RestConnectionConfig>, request: RestConnectionRequest, policy: ConnectionPolicy | undefined): string[] {
  const issues: string[] = []
  const method = request.method ?? 'GET'
  if (policy?.methods && !policy.methods.includes(method)) {
    issues.push(`method ${method} is not allowed for connection ${connection.uid}`)
  }
  if (policy?.pathPrefixes && !policy.pathPrefixes.some((prefix) => matchesPathPrefix(connection.config.baseUrl, request.path, prefix))) {
    issues.push(`path ${request.path} is not within an allowed prefix for connection ${connection.uid}`)
  }
  return issues
}

function buildUrl(config: RestConnectionConfig, request: RestConnectionRequest): string {
  const url = joinUrl(config.baseUrl, request.path)
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

/** Combines the caller's signal with a `timeoutMs`-derived one. `dispose()` must run once the request settles, or the timer leaks. */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number | undefined): { signal: AbortSignal | undefined; dispose: () => void } {
  if (!timeoutMs) return { signal, dispose: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs)
  const forwardAbort = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', forwardAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forwardAbort)
    },
  }
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/** Reads and JSON-parses a response body while enforcing `maxResponseBytes` — `response.json()` has no size cap of its own. */
async function readJsonWithLimit(response: Response, maxBytes: number | undefined): Promise<unknown> {
  if (!maxBytes || !response.body) return response.json()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`REST connection response exceeded maxResponseBytes (${maxBytes})`)
    }
    chunks.push(value)
  }
  return JSON.parse(new TextDecoder().decode(concatChunks(chunks, total)))
}

/**
 * Called before each request; merged under the connection's static
 * `config.headers` (config headers win on conflict). `RegisteredConnection.config`
 * is meant for server-owned, non-rotating secrets (test.md §5.1) — this hook
 * is the escape hatch for hosts whose auth rotates per end-user session
 * instead (a refreshed JWT, e.g.), so they can still use `restConnectionAdapter`
 * directly rather than writing a custom `ConnectionAdapter` (provisr-poc-findings.md #7).
 */
export interface RestConnectionAdapterOptions {
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  fetchImpl?: typeof fetch
}

async function fetchRows(
  connection: RegisteredConnection<RestConnectionConfig>,
  request: RestConnectionRequest,
  signal: AbortSignal | undefined,
  mcpPolicy: ConnectionMcpPolicy | undefined,
  fetchImpl: typeof fetch,
  headers: Record<string, string> | undefined,
): Promise<Record<string, unknown>[]> {
  const combined = withTimeout(signal, mcpPolicy?.timeoutMs)
  let json: unknown
  try {
    const response = await fetchImpl(buildUrl(connection.config, request), {
      method: request.method ?? 'GET',
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: combined.signal,
    })
    if (!response.ok) {
      throw new Error(`REST connection request failed: ${response.status} ${response.statusText}`)
    }
    json = await readJsonWithLimit(response, mcpPolicy?.maxResponseBytes)
  } finally {
    combined.dispose()
  }
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

export function createRestConnectionAdapter(
  options: RestConnectionAdapterOptions = {},
): ConnectionAdapter<RestConnectionConfig, RestConnectionRequest> {
  // Resolved per-call rather than captured once — `options.fetchImpl` may
  // itself be undefined (falling back to the ambient `fetch`), and reading
  // `fetch` here eagerly would freeze in whatever `globalThis.fetch` was at
  // factory-construction time, missing e.g. a test's `vi.spyOn(globalThis, 'fetch')`
  // applied afterward.
  function currentFetch(): typeof fetch {
    return options.fetchImpl ?? fetch
  }

  async function resolveHeaders(config: RestConnectionConfig): Promise<Record<string, string> | undefined> {
    const dynamicHeaders = options.headers ? await options.headers() : undefined
    return dynamicHeaders || config.headers ? { ...dynamicHeaders, ...config.headers } : undefined
  }

  return {
    type: 'rest',
    requestSchema: restRequestSchema,

    async test(connection, context) {
      // Any completed HTTP response — even a 404 at the bare base URL, which
      // many APIs (including this repo's demo one) don't serve anything at —
      // proves the connection is reachable. Only a network-level failure
      // (fetch throwing: DNS, connection refused, timeout, ...) means it isn't.
      const start = Date.now()
      const combined = withTimeout(context.signal, connection.mcpPolicy?.timeoutMs)
      try {
        const headers = await resolveHeaders(connection.config)
        const response = await currentFetch()(connection.config.baseUrl, { method: 'GET', headers, signal: combined.signal })
        return {
          ok: true,
          message: response.ok ? undefined : `reachable, but the base URL itself responded ${response.status} ${response.statusText}`,
          latencyMs: Date.now() - start,
        }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'connection test failed', latencyMs: Date.now() - start }
      } finally {
        combined.dispose()
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
      const headers = await resolveHeaders(connection.config)
      const rows = await fetchRows(connection, request, context.signal, connection.mcpPolicy, currentFetch(), headers)
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
      const headers = await resolveHeaders(connection.config)
      return fetchRows(connection, request, context.signal, connection.mcpPolicy, currentFetch(), headers)
    },
  }
}

export const restConnectionAdapter: ConnectionAdapter<RestConnectionConfig, RestConnectionRequest> = createRestConnectionAdapter()
