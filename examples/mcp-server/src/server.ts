#!/usr/bin/env node
/**
 * Minimal MCP server exposing resourcekit's staged-generation primitives
 * directly, with no orchestration loop of its own — see
 * docs/staged-generation-experiment.md "Final decision" for why. This lets a
 * real MCP client (Claude, etc.) build a resourcekit document by actually
 * calling tools and reasoning about the responses, instead of the
 * playground's synthetic random auto-filler.
 *
 * Uses the exact same registry as the playground (same kind adapters, same
 * scope shape), so what a real client produces here reflects the real
 * schema, not a hand-rolled toy one.
 */
import type { MutationBinding, MutationResolver } from '@loykin/resourcekit'
import {
  createConnectionDataResolver,
  createRegistry,
  nextStage,
  nextStageBatch,
  restConnectionAdapter,
  restResolver,
  singleKindSchema,
  staticResolver,
  validateResource,
} from '@loykin/resourcekit'
import { createFirstPartyResourceAdapters, publicKindNames } from '@loykin/resourcekit/adapters'
import { createDatasourceKitConnectionAdapter } from '@loykin/resourcekit/adapters/datasourcekit'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'
import { createConnectionStore } from './connection-store.js'
import { DEMO_API_TOKEN, startDemoApi } from './demo-api.js'
import { startDemoDb } from './demo-db.js'
import { DATASOURCE_TYPE, DATASOURCE_UID, startDemoDatasourceKit } from './demo-datasourcekit.js'
import { sqliteConnectionAdapter } from './sqlite-connection-adapter.js'

const demoApi = await startDemoApi()
const demoDb = startDemoDb()
const demoDatasourceKit = startDemoDatasourceKit()

const restMutationResolver: MutationResolver = async (binding, payload) => {
  const b = binding as Extract<MutationBinding, { target: 'rest' }>
  const response = await fetch(b.url, {
    method: b.method ?? 'PATCH',
    headers: { 'content-type': 'application/json', ...b.headers },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`REST mutation failed: ${response.status} ${response.statusText}`)
  return response.json()
}

const registry = createRegistry()
registry.use({
  name: 'mcp-server-example-resolvers',
  dataResolvers: { static: staticResolver, rest: restResolver, connection: createConnectionDataResolver(registry) },
  mutationResolvers: { rest: restMutationResolver },
  connectionAdapters: { rest: restConnectionAdapter, sqlite: sqliteConnectionAdapter, datasourcekit: createDatasourceKitConnectionAdapter(demoDatasourceKit) },
})
registry.use(createFirstPartyResourceAdapters())

// Registered connections — resource documents reference them by uid
// ({ source: 'connection', connection: 'demo-users', request }), never a raw
// URL/DSN, and MCP only ever sees the redacted ConnectionSummary (test.md §5).
registry.registerConnection({
  uid: 'demo-users',
  type: 'rest',
  name: 'Demo Users API',
  description: 'In-memory demo REST API for this session — GET /users, GET /users/:id, PATCH /users/:id.',
  config: { baseUrl: demoApi.baseUrl },
  policy: { methods: ['GET', 'PATCH'], pathPrefixes: ['/users'] },
  mcpPolicy: { test: true, preview: true, mutate: false, maxRows: 20 },
})
// A second connection on a completely different adapter type (SQLite, not
// REST) — proves ConnectionAdapter is genuinely pluggable, see
// sqlite-connection-adapter.ts.
registry.registerConnection({
  uid: 'demo-orders',
  type: 'sqlite',
  name: 'Demo Orders DB',
  description: 'In-memory demo SQLite database for this session — table "orders" (id, customer, amount, status).',
  config: { db: demoDb.db, tables: demoDb.tables },
  mcpPolicy: { test: true, inspect: true, preview: true, mutate: false, maxRows: 20 },
})
// A connection whose backend requires a secret — proves a connection can
// carry a credential that MCP never sees (test.md §5.3). The token lives
// only in `config.headers` here, server-side; list_connections/get_connection
// only ever expose the ConnectionSummary shape (uid/type/name/requestSchema/
// capabilities), never `config`.
registry.registerConnection({
  uid: 'secure-reports',
  type: 'rest',
  name: 'Secure Reports API',
  description: 'Auth-gated demo REST API — GET /secure/reports requires a bearer token.',
  config: { baseUrl: demoApi.baseUrl, headers: { authorization: `Bearer ${DEMO_API_TOKEN}` } },
  policy: { methods: ['GET'], pathPrefixes: ['/secure'] },
  mcpPolicy: { test: true, preview: true, mutate: false, maxRows: 20 },
})
// A real, public third-party API — for building actual example documents
// through this server's own tools, not just our demo backends.
registry.registerConnection({
  uid: 'github',
  type: 'rest',
  name: 'GitHub API',
  description: 'Public GitHub REST API (read-only here) — GET /orgs/:org/repos, GET /repos/:owner/:repo.',
  config: { baseUrl: 'https://api.github.com', headers: { accept: 'application/vnd.github+json' } },
  policy: { methods: ['GET'], pathPrefixes: ['/orgs', '/repos'] },
  mcpPolicy: { test: true, preview: true, mutate: false, maxRows: 10 },
})

// A third adapter type, backed by the real published `@loykin/datasourcekit`
// (test.md §8.2, §11 step 9) instead of a hand-written ConnectionAdapter —
// `demo-datasourcekit.ts` implements the `DatasourceManagerBackend` contract
// DatasourceKit expects any real backend to expose. inspect_connection here
// lists namespaces (no path) or a namespace's fields (path: "metrics");
// preview/resolve go through DatasourceManager.instances.query.
registry.registerConnection({
  uid: 'demo-metrics',
  type: 'datasourcekit',
  name: 'Demo Metrics (DatasourceKit)',
  description: 'In-memory demo metrics via a DatasourceKit-backed connection — fields host, region, cpuPercent, memoryPercent, request shape { metric: "cpuPercent" | "memoryPercent", region? }.',
  config: { datasourceUid: DATASOURCE_UID, datasourceType: DATASOURCE_TYPE },
  mcpPolicy: { test: true, inspect: true, preview: true, mutate: false, maxRows: 20 },
})

// A connection sourced from a ConnectionProvider instead of
// registerConnection — stands in for a host that keeps its own connections
// in a database and looks them up dynamically rather than baking them into
// server boot code (test.md §12). Same backend as demo-users; what differs
// is only how the registry finds it.
const connectionStore = createConnectionStore()
registry.setConnectionProvider(connectionStore.provider)
connectionStore.add({
  uid: 'demo-users-dynamic',
  type: 'rest',
  name: 'Demo Users API (provider-backed)',
  description: 'Same backend as demo-users, but sourced from a ConnectionProvider — proves connections can be discovered dynamically instead of only registered at server boot.',
  config: { baseUrl: demoApi.baseUrl },
  policy: { methods: ['GET'], pathPrefixes: ['/users'] },
  mcpPolicy: { test: true, preview: true, mutate: false, maxRows: 20 },
})

const scope = registry.scope({
  apiVersions: ['resourcekit.dev/v1alpha1'],
  kinds: { include: publicKindNames(registry) },
  rootLevels: ['template'],
  maxDepth: 8,
  connections: {
    allow: ['demo-users', 'demo-users-dynamic', 'demo-orders', 'demo-metrics', 'secure-reports', 'github'],
    capabilities: { test: true, inspect: true, preview: true, mutate: false },
  },
})

const server = new McpServer(
  { name: 'resourcekit-example', version: '0.0.0' },
  {
    instructions: `Build a resourcekit resource document, one position at a time, then validate it.

Workflow:
1. Call list_root_templates with no arguments to see which kinds can be the document root.
2. Pick one. Its candidate entry is envelope-only (apiVersion/kind, no spec) — call get_kind_spec_schema with that {apiVersion, kind} to get its actual spec fields, then build its envelope: { apiVersion, kind, spec, slots: [] }.
3. Call next_stage_batch with that node's { apiVersion, kind } to resolve every one of its slots at once.
   - "fixed" entries have exactly one valid kind — insert them directly, no choice needed.
   - "schema" covers every slot with a real choice. Each candidate kind listed there is envelope-only too — call get_kind_spec_schema on whichever one you pick before filling its spec. Each open slot becomes a key in the slots array (name omitted for the default slot); a repeatable slot's property is an array — add one item per entry you want, respecting minItems/maxItems. Omitting an optional key means declining that slot.
4. For every node you just added, repeat step 3 (and step 2's get_kind_spec_schema call) on it — recurse until nothing has an open slot left anywhere in the tree.
5. Call validate_document with the finished document to confirm it's structurally valid before presenting it.

The "slots" array shape (this is never shown as an example in any schema, only described in prose — read this carefully): each entry is { name?: string, items: Resource[] }. Omit "name" for a kind's default slot; use the slot's name for a named slot. Example — a node with one child in its default slot and one in a "actions" slot:
  "slots": [
    { "items": [ { "apiVersion": "...", "kind": "...", "spec": {...} } ] },
    { "name": "actions", "items": [ { "apiVersion": "...", "kind": "...", "spec": {...} } ] }
  ]

Variable interpolation: a page variable declared in some ancestor's spec.variables can be referenced inside a string field as \${variableName} (e.g. a rest binding's url: "\${baseUrl}/users/\${selectedId}"). The runtime substitutes the variable's current value before resolving. Reading a variable's own name in code (e.g. valueRef/from) uses the plain form "variables.<name>", not \${...} — check each field's own description for which form it expects.

Data source constraint: a "static" data binding is fixed, inline rows baked into the document — it cannot be filtered by a variable, because there's no filtering step at all, it just returns those exact rows every time. If you're building a selection-driven detail view (e.g. DetailView whose content should follow whichever row is selected in a sibling list), its data binding needs a source that can actually be parameterized per-request.

Connections (test.md §5-7): rather than hardcoding a URL/DSN into a data binding, call list_connections to see what's registered. This example registers connections on three different adapter types — proving the contract isn't REST-specific:
  "demo-users" (type "rest")   -> GET /users, GET /users/:id, PATCH /users/:id. Each user has: id, name, email, role.
  "demo-orders" (type "sqlite") -> table "orders" (id, customer, amount, status), via a request shape { table, where?, limit? }. inspect_connection on this one lists tables (no path) or a table's columns (path: "orders").
  "demo-metrics" (type "datasourcekit", backed by the real @loykin/datasourcekit package) -> fields host, region, cpuPercent, memoryPercent, via a request shape { metric: "cpuPercent" | "memoryPercent", region? }. inspect_connection lists namespaces (no path) or a namespace's fields (path: "metrics").
Before binding to any of them, call test_connection to confirm it's reachable, validate_connection_request to check a candidate request against its policy, and preview_connection to see a capped, real sample of what it returns — never the full result set. Once you're confident, use it in a resource document as a data binding, e.g.: { "source": "connection", "connection": "demo-orders", "request": { "table": "orders", "where": { "status": "paid" } } } — never embed the connection's real base URL/DSN, which MCP never sees.
Use "demo-users" for a SelectableList/DetailView (id can be a \${variable}) or a FormView's submit.mutation (target: "rest"); use "demo-orders" or "demo-metrics" for a TableView/ChartView needing simple table+filter data.`,
  },
)

server.registerTool(
  'list_root_templates',
  {
    title: 'List root templates',
    description:
      'Get the schema for the document root — either a single fixed kind, or a JSON Schema of candidate root kinds to choose from. Candidates are envelope-only (apiVersion/kind, no spec) — call get_kind_spec_schema on whichever one you pick.',
    inputSchema: {},
  },
  async () => {
    const result = nextStage(scope, {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.registerTool(
  'next_stage_batch',
  {
    title: 'Resolve every slot of a node at once',
    description:
      "Given a node already in the document (by its apiVersion/kind), resolve all of its slots in one call: slots with exactly one valid kind come back under \"fixed\" (insert directly); every slot with a real choice is one property of \"schema\" (oneOf for a single slot, an array of oneOf items with minItems/maxItems for a repeatable slot). Every candidate kind listed is envelope-only (apiVersion/kind, no spec) — call get_kind_spec_schema on whichever one you pick before filling its spec. Omitted optional keys are declined slots.",
    inputSchema: {
      apiVersion: z.string().describe("The node's apiVersion, e.g. \"resourcekit.dev/v1alpha1\"."),
      kind: z.string().describe('The kind of the node whose slots should be resolved, e.g. "Workbench".'),
    },
  },
  async ({ apiVersion, kind }) => {
    const result = nextStageBatch(scope, { parent: { apiVersion, kind } })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.registerTool(
  'get_kind_spec_schema',
  {
    title: "Get a kind's full spec schema",
    description:
      'list_root_templates and next_stage_batch only tell you which kinds are structurally valid where — their candidates are envelope-only. Call this once you\'ve picked a kind to get its full envelope + spec JSON Schema (own $defs) so you know what fields it actually needs.',
    inputSchema: {
      apiVersion: z.string().describe("The kind's apiVersion, e.g. \"resourcekit.dev/v1alpha1\"."),
      kind: z.string().describe('The kind to get the spec schema for, e.g. "TableView".'),
    },
  },
  async ({ apiVersion, kind }) => {
    const result = singleKindSchema(scope, apiVersion, kind)
    return { content: [{ type: 'text', text: result ? JSON.stringify(result, null, 2) : `Unknown kind in this scope: ${kind}` }] }
  },
)

async function connectionSummary(uid: string) {
  return (await scope.listConnections()).find((connection) => connection.uid === uid)
}

/** Resolves the render-time connection + adapter for a uid this scope has already allowed (i.e. `connectionSummary(uid)` returned something). */
async function connectionAndAdapter(uid: string) {
  const connection = await scope.getConnection(uid)
  const adapter = connection ? scope.getConnectionAdapter(connection.type) : undefined
  return connection && adapter ? { connection, adapter } : undefined
}

server.registerTool(
  'list_connections',
  {
    title: 'List connections available to this scope',
    description:
      'Lists registered connections this MCP scope can see — uid, type, name/description, request schema, and which of test/inspect/preview/mutate are actually usable here. Never includes base URLs, DSNs, or credentials (test.md §5.3) — those stay server-side. Use a uid from here with test_connection/validate_connection_request/preview_connection before binding to it in a document.',
    inputSchema: {},
  },
  async () => ({ content: [{ type: 'text', text: JSON.stringify(await scope.listConnections(), null, 2) }] }),
)

server.registerTool(
  'get_connection',
  {
    title: 'Get one connection summary',
    description: 'Same shape as one entry from list_connections, for a single known uid.',
    inputSchema: { uid: z.string().describe('Connection uid, e.g. "demo-users".') },
  },
  async ({ uid }) => {
    const summary = await connectionSummary(uid)
    return { content: [{ type: 'text', text: summary ? JSON.stringify(summary, null, 2) : `Unknown or not-exposed connection: ${uid}` }] }
  },
)

server.registerTool(
  'test_connection',
  {
    title: 'Test a connection is reachable',
    description: 'Pings the connection and reports ok/latency — call before relying on it for preview or a document data binding.',
    inputSchema: { uid: z.string() },
  },
  async ({ uid }) => {
    const summary = await connectionSummary(uid)
    if (!summary?.capabilities.test) return { content: [{ type: 'text', text: `Connection ${uid} does not expose test in this scope.` }] }
    const resolved = await connectionAndAdapter(uid)
    const result = await resolved?.adapter.test?.(resolved.connection, {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.registerTool(
  'inspect_connection',
  {
    title: "Inspect a connection's fields/namespaces/schema",
    description: 'Explores what a connection exposes structurally (e.g. available fields) — not all adapters implement this; check list_connections capabilities first.',
    inputSchema: { uid: z.string(), path: z.string().optional().describe('Adapter-specific sub-path to inspect, e.g. a table/namespace name.') },
  },
  async ({ uid, path }) => {
    const summary = await connectionSummary(uid)
    if (!summary?.capabilities.inspect) return { content: [{ type: 'text', text: `Connection ${uid} does not expose inspect in this scope.` }] }
    const resolved = await connectionAndAdapter(uid)
    const result = await resolved?.adapter.inspect?.(resolved.connection, { path }, {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.registerTool(
  'validate_connection_request',
  {
    title: 'Validate a candidate request against a connection policy',
    description: 'Checks a request (adapter-specific shape, e.g. REST { method, path, ... }) against the connection\'s registered policy before you spend a preview_connection call on it.',
    inputSchema: { uid: z.string(), request: z.unknown().describe("Adapter-specific request, e.g. REST's { method?, path, query?, body?, rowsPath? }.") },
  },
  async ({ uid, request }) => {
    const resolved = await connectionAndAdapter(uid)
    if (!resolved) return { content: [{ type: 'text', text: `Unknown or not-exposed connection: ${uid}` }] }
    const result = await resolved.adapter.validate?.(resolved.connection, request, {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.registerTool(
  'preview_connection',
  {
    title: 'Preview a capped, real sample of a request',
    description:
      'Runs the request through the exact same execution path a rendered document would (test.md §7) but capped to a small row count and never the full result set — use this to see real field names/shapes before writing a document\'s fields/columns.',
    inputSchema: { uid: z.string(), request: z.unknown() },
  },
  async ({ uid, request }) => {
    const summary = await connectionSummary(uid)
    if (!summary?.capabilities.preview) return { content: [{ type: 'text', text: `Connection ${uid} does not expose preview in this scope.` }] }
    const resolved = await connectionAndAdapter(uid)
    try {
      const result = await resolved?.adapter.preview?.(resolved.connection, request, {})
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (error) {
      return { content: [{ type: 'text', text: `Preview failed: ${error instanceof Error ? error.message : String(error)}` }] }
    }
  },
)

server.registerTool(
  'validate_document',
  {
    title: 'Validate a finished resourcekit document',
    description:
      'Structurally validates a full resourcekit resource document (apiVersion/kind/spec/slots tree) against this scope — spec schemas, slot policies, and required slots. Call this once you believe the document is complete.',
    inputSchema: {
      resource: z.unknown().describe('The full resource document: { apiVersion, kind, spec, slots?, metadata? }.'),
    },
  },
  async ({ resource }) => {
    const result = validateResource(resource as never, scope)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`resourcekit MCP example server running on stdio (demo API at ${demoApi.baseUrl})`)
}

process.on('exit', () => {
  demoApi.close()
  demoDb.db.close()
})

main().catch((error: unknown) => {
  console.error('Server error:', error)
  process.exit(1)
})
