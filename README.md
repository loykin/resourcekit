# @loykin/resourcekit

Declarative resource runtime for Loykin kits — an AI/MCP agent writes a JSON
resource document, the application renders it with its own design system.

```jsonc
{
  "apiVersion": "resourcekit.dev/v1alpha1",
  "kind": "ListDetail",
  "spec": { "variables": [{ "name": "customerId", "persist": "url" }] },
  "slots": [
    { "name": "list", "items": [
      { "apiVersion": "resourcekit.dev/v1alpha1", "kind": "SelectableList",
        "spec": {
          "data": { "source": "datasource", "datasourceUid": "crm", "query": { "table": "customers" } },
          "primary": { "field": "name" },
          "selectedRef": "variables.customerId"
        } }
    ]}
  ]
}
```

- **Headless core** (`@loykin/resourcekit`) — registry/plugin host, JSON Schema
  validation and scoped schema generation, variable engine, data/mutation
  binding dispatch. No React dependency.
- **React adapter** (`@loykin/resourcekit/react`) — recursive renderer with
  parent-owned slots and unknown-kind fallback.
- **Kinds are plugins** (`@loykin/resourcekit/adapters`) — designkit, gridkit,
  chartkit, basekit, and a resource-view kit (`SelectableList`,
  `ObjectFields`, `JsonViewer`) contribute kind manifests; apps register only
  what they support, and an AI/MCP client receives a scoped schema
  describing exactly that — never the full registry.

## Resource model

Every node in a document is a small, Kubernetes-like envelope:

- **`apiVersion`/`kind`** — identifies which registered kind manifest this
  node is (e.g. `ListDetail`, `SelectableList`).
- **`spec`** — that kind's own config. Only the kind itself reads its shape;
  no other kind or the runtime ever looks inside it.
- **`slots`** — named placement groups holding child nodes (`{ name?, items }`
  — `name` omitted means the kind's default slot). A slot's `SlotPolicy`
  says which kinds are allowed there and how many; a leaf kind (no slots)
  just doesn't have this key.

Ownership is strict in both directions: the runtime owns kind lookup,
recursion, slot rendering, fallback, and binding dispatch; a kind owns only
its own `spec` schema and prop mapping. A leaf never knows which slot it's
sitting in, and a parent never reads a child's `spec`.

## How it runs

```tsx
import { createRegistry } from '@loykin/resourcekit'
import type { Resource } from '@loykin/resourcekit'
import { createFirstPartyResourceAdapters } from '@loykin/resourcekit/adapters'
import { ResourceRenderer } from '@loykin/resourcekit/react'

const registry = createRegistry()
registry.use(createFirstPartyResourceAdapters()) // or just the kits your app supports
registry.use({ name: 'my-resolvers', dataResolvers: { datasource: myDatasourceResolver } })

function Page({ resource }: { resource: Resource }) {
  return <ResourceRenderer registry={registry} resource={resource} onEvent={handleEvent} />
}
```

`ResourceRenderer` recurses the document itself: for each node it looks up
the kind's manifest, resolves `spec.data`/`spec.events` through whatever
resolvers you registered, declares/reads page variables, and calls the
kind's own `render` function with its slots already resolved into React
nodes. An unknown or not-yet-loaded kind degrades that one node to
`renderUnknownKind` instead of failing the whole document.
`validateResource(resource, scope)` runs the same structural checks (spec
schemas, slot policies, required slots) without rendering anything — useful
right after an AI/MCP client hands back a document, before you render it.

## Staged generation

An AI/MCP client doesn't get one giant schema and generate a whole document
in one shot. It builds a document one position at a time:

1. `nextStage(scope, {})` — what kind(s) can the document root be?
2. `nextStageBatch(scope, { parent })` — resolve every slot on an
   already-chosen node at once (`fixed` slots have exactly one valid kind;
   `schema` covers the rest — its candidates are envelope-only).
3. `singleKindSchema(scope, apiVersion, kind)` — once a kind is picked, its
   full spec fields.
4. Recurse step 2–3 into whatever was just added, until nothing has an open
   slot left; then `validateResource` the finished document.

resourcekit doesn't ship an orchestration loop around this — the caller (an
MCP client's own tool-calling loop, a host app's own loop) already is one.

`examples/mcp-server/` is a small, working MCP server exposing exactly these
primitives as tools, so a real MCP client can be pointed at it directly
instead of the playground's own step-by-step demo.

## Development

```bash
pnpm install
pnpm dev          # library watch + playground
pnpm test
pnpm build
```

## Status

Early development. The headless core (registry, validation, scoped schema
generation, variable engine, data/mutation resolvers) and the React renderer
are implemented and tested; kind adapters for the Loykin kits are
demonstrated in the playground (`pnpm dev`) and exercised end to end via the
MCP server example.

## License

MIT
