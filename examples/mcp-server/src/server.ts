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
import { createRegistry, nextStage, nextStageBatch, restResolver, singleKindSchema, staticResolver, validateResource } from '@loykin/resourcekit'
import { createFirstPartyResourceAdapters, publicKindNames } from '@loykin/resourcekit/adapters'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'
import { startDemoApi } from './demo-api.js'

const demoApi = await startDemoApi()

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
  dataResolvers: { static: staticResolver, rest: restResolver },
  mutationResolvers: { rest: restMutationResolver },
})
registry.use(createFirstPartyResourceAdapters())

const scope = registry.scope({
  apiVersions: ['resourcekit.dev/v1alpha1'],
  kinds: { include: publicKindNames(registry) },
  rootLevels: ['template'],
  maxDepth: 8,
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

Data source constraint: a "static" data binding is fixed, inline rows baked into the document — it cannot be filtered by a variable, because there's no filtering step at all, it just returns those exact rows every time. If you're building a selection-driven detail view (e.g. RecordScope whose content should follow whichever row is selected in a sibling list), its data binding needs a source that can actually be parameterized per-request — "rest" with a \${variable} in the url, pointed at a real endpoint. For exactly this purpose, a tiny demo REST API is running for this session at ${demoApi.baseUrl}:
  GET  ${demoApi.baseUrl}/users        -> full list, for a SelectableList/TableView
  GET  ${demoApi.baseUrl}/users/:id    -> one user, for a RecordScope's data (id can be a \${variable})
  PATCH ${demoApi.baseUrl}/users/:id   -> partial update, for a ResourceForm's submit.mutation (target: "rest")
Each user has: id, name, email, role.`,
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

process.on('exit', () => demoApi.close())

main().catch((error: unknown) => {
  console.error('Server error:', error)
  process.exit(1)
})
