# @loykin/resourcekit

Declarative resource runtime for AI/MCP-generated UI. An AI/MCP client
produces a scoped JSON resource document; the application validates it and
renders it with its own design system.

resourcekit owns the document runtime: kind lookup, recursive slot rendering,
validation, variables, and data/mutation dispatch. Kind plugins own their
JSON Schema, slot policy, and mapping to existing kit components.

> **Status:** early development (`0.0.0-dev`). The public contracts are
> implemented and tested, but APIs and first-party kind catalogs may still
> change before the first stable release.

## Install

Install the headless core:

```bash
pnpm add @loykin/resourcekit
```

For React rendering, also install React and the kit adapters your application
uses. For example, a designkit-only application needs:

```bash
pnpm add react react-dom @loykin/designkit
```

The kit and React packages are optional peer dependencies: headless consumers
do not need them, and applications can install only the adapters they use.

| Import | Purpose |
| --- | --- |
| `@loykin/resourcekit` | React-free core: registry, scoping, schema generation, validation, variables, document dataflow, resolvers, connections, and submit runtime |
| `@loykin/resourcekit/react` | `ResourceRenderer` and React render contracts |
| `@loykin/resourcekit/adapters/designkit` | designkit kinds |
| `@loykin/resourcekit/adapters/gridkit` | gridkit kinds |
| `@loykin/resourcekit/adapters/chartkit` | chartkit kinds |
| `@loykin/resourcekit/adapters/basekit` | basekit kinds |
| `@loykin/resourcekit/adapters/datasourcekit` | `ConnectionAdapter` bridging registered connections to `@loykin/datasourcekit` |
| `@loykin/resourcekit/adapters` | All first-party kind adapters plus resource views; use when all required kit peers are installed. Connection adapters (e.g. `datasourcekit`) are not included — import them from their own subpath. |

## Quick start

This example registers one adapter, creates an AI-safe scope, validates a
document, and renders it. It contains no placeholders or external data
dependencies.

```tsx
import { createRegistry, validateResource } from '@loykin/resourcekit'
import type { Resource } from '@loykin/resourcekit'
import { createDesignKitPlugin } from '@loykin/resourcekit/adapters/designkit'
import { ResourceRenderer } from '@loykin/resourcekit/react'
import type { KindRenderFn } from '@loykin/resourcekit/react'

const registry = createRegistry<KindRenderFn>()
registry.use(createDesignKitPlugin())

const scope = registry.scope({
  apiVersions: ['resourcekit.dev/v1alpha1'],
  kinds: { include: ['DataBody', 'DataBodyGroup', 'DataBodyField'] },
  rootLevels: ['template'],
  maxDepth: 4,
})

const resource: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'DataBody',
  spec: {
    title: 'Customer',
    description: 'Generated from a validated resource document.',
  },
  slots: [
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DataBodyGroup',
          spec: { title: 'Profile' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DataBodyField',
                  spec: { label: 'Status', value: 'Active' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

const validation = validateResource(resource, scope)
if (!validation.valid) {
  throw new Error(JSON.stringify(validation.issues, null, 2))
}

export function App() {
  return (
    <ResourceRenderer
      registry={scope}
      resource={resource}
      renderUnknownKind={(node) => <p>Unsupported kind: {node.kind}</p>}
      renderLoading={() => <p>Loading…</p>}
      renderError={(error) => <p>{String(error)}</p>}
      onEvent={(event, payload) => console.log(event, payload)}
    />
  )
}
```

Use the same scoped registry for schema generation, validation, and rendering
when the document came from an AI/MCP client. This prevents the generator from
using kinds or capabilities that the application did not expose.

## Resource model

Every node uses a Kubernetes-like envelope:

```ts
interface DataRef {
  $data: string
  path?: string
}

interface VariableRef {
  $variable: string
}

interface Resource<TSpec = unknown> {
  apiVersion: string
  kind: string
  metadata?: {
    name?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  spec: TSpec
  bindings?: Record<string, DataRef | VariableRef>
  slots?: Array<{
    name?: string
    items: Resource[]
  }>
}
```

- `apiVersion` and `kind` select a registered kind manifest.
- `spec` belongs exclusively to that kind and is checked against its schema.
- `bindings` connects kind-declared ports to document data nodes or flat
  variables. Adapters access those values only through the runtime context.
- `slots` belong to the parent. Omit `name` for the default slot.
- Each parent's `SlotPolicy` controls accepted child kinds and cardinality.
- A leaf kind has no slot policy and must not contain `slots`.

Parents never inspect child specs, and children never know which parent slot
contains them. Unknown or not-yet-loaded kinds degrade only that node to
`renderUnknownKind`; they do not crash the whole document.

## Registry and adapters

The registry is a runtime plugin host. Plugins can contribute kind manifests,
data resolvers, mutation resolvers, and connection adapters.

```ts
registry.use(createDesignKitPlugin())

registry.use({
  name: 'application-runtime',
  dataResolvers: { static: staticResolver, rest: restResolver },
  mutationResolvers: { rest: myRestMutationResolver },
})
```

For applications that have all first-party kit peers installed:

```ts
import {
  createFirstPartyResourceAdapters,
  publicKindNames,
} from '@loykin/resourcekit/adapters'

registry.use(createFirstPartyResourceAdapters())

const scope = registry.scope({
  kinds: { include: publicKindNames(registry) },
  rootLevels: ['template'],
})
```

The first-party adapters expose short public aliases such as `Workbench`,
`DataBody`, `TableView`, `ChartView`, and `FilterControl`. The combined adapter
also includes `DetailView`, `SelectableList`, `ObjectFields`, and `JsonViewer`.
Use generated schemas as the authoritative description of each enabled kind's
current spec and slot policy rather than hard-coding the catalog into an AI
prompt.

## Scoping and validation

`registry.scope(...)` creates the restricted view that may be exposed to an
AI/MCP client. A scope can restrict:

- API versions and kinds
- spec fields and locked values
- slots
- variables, datasources, and actions
- registered connections and MCP capabilities
- root composition levels and maximum depth

```ts
const scope = registry.scope({
  apiVersions: ['resourcekit.dev/v1alpha1'],
  kinds: {
    include: ['ListDetail', 'SelectableList', 'DetailView'],
  },
  variables: {
    allow: ['customerId'],
  },
  datasources: {
    allow: ['crm'],
  },
  actions: {
    allow: ['customer.update'],
  },
  connections: {
    allow: ['crm-api'],
    capabilities: { test: true, preview: true, mutate: false },
  },
  rootLevels: ['template'],
  maxDepth: 8,
})

const result = validateResource(resource, scope)
if (!result.valid) {
  for (const issue of result.issues) {
    console.error(issue.path, issue.message)
  }
}
```

Validation checks the common envelope, registered kinds, kind spec schemas,
binding ports, slot policies, required slots, scoped capabilities, variable
references, resolver registration, and datasource/action allowlists. For a
`ResourceDocument`, `validateResourceDocument` additionally checks its data
graph, references, cycles, and writable-state targets. Validate every
AI-produced document before rendering it.

Never give an AI/MCP client a schema built from the unrestricted registry.

## Resolver bindings

A kind that owns a `spec.data` field asks the runtime to dispatch its binding
by the `source` discriminator.

resourcekit ships `static` and `rest` resolvers:

```ts
import {
  restResolver,
  staticResolver,
} from '@loykin/resourcekit'

registry.use({
  name: 'core-data-resolvers',
  dataResolvers: {
    static: staticResolver,
    rest: restResolver,
  },
})
```

```json
{
  "source": "static",
  "rows": [
    { "id": "1", "name": "Ada" },
    { "id": "2", "name": "Grace" }
  ]
}
```

```json
{
  "source": "rest",
  "url": "https://api.example.com/customers/${customerId}",
  "method": "GET",
  "rowsPath": "data.items"
}
```

`valuePath` can project a nested value after a resolver returns rows. The
`datasource` binding envelope is part of the core contract, but its resolver
must come from a datasourcekit adapter package or the host application; it is
not bundled in resourcekit core.

## Resource bindings, variables, and events

Variables are one flat page scope with `string | string[]` values. A variable
can be transient or synchronized to a URL query parameter.

```json
{
  "variables": [
    {
      "name": "customerId",
      "type": "string",
      "default": "1",
      "persist": "url"
    }
  ]
}
```

Use `${customerId}` inside interpolated resolver and mutation binding strings.
For a kind-controlled value, connect the kind's named binding port with a
structural `VariableRef`:

```json
{
  "bindings": {
    "selected": { "$variable": "customerId" }
  }
}
```

The kind manifest declares which ports exist and whether each port is
writable. For example:

```ts
bindingPolicy: {
  inputs: {
    selected: {
      description: 'Currently selected row ID.',
      schema: { type: 'string' },
    },
  },
}
```

A selectable kind can update the same variable through an event policy:

```json
{
  "bindings": {
    "selected": { "$variable": "customerId" }
  },
  "spec": {
    "events": {
      "select": {
        "kind": "setVariable",
        "variable": "customerId",
        "from": "row.id"
      }
    }
  }
}
```

The React runtime applies `setVariable` and `setData` policies and forwards
`emit` policies through `ResourceRenderer`'s `onEvent` callback. A writable
port dispatches through `ctx.bindings.write`; adapters never own a parallel
integration store. `internal` behavior stays inside the kind. `action` is
currently schema/validation vocabulary; use submit/mutation dispatch or an
emitted host event when an action must execute.

## Document dataflow

`ResourceDocument` adds one document-scoped reactive store and data graph
around the existing root resource. `state` nodes retain values; `resolve`
nodes dispatch registered resolver bindings. Structural `{ "$data": "..." }`
references define consumers and dependency edges.

```ts
import {
  buildResourceDocumentSchema,
  validateResourceDocument,
} from '@loykin/resourcekit'
import type { ResourceDocument } from '@loykin/resourcekit'

const document: ResourceDocument = {
  data: {
    nodes: {
      selectedCluster: { kind: 'state', initialValue: 'us-east' },
      selectedHost: { kind: 'state' },
      metrics: {
        kind: 'resolve',
        binding: {
          source: 'connection',
          connection: 'metrics',
          request: {
            operation: 'metrics',
            cluster: { $data: 'selectedCluster' },
          },
        },
      },
    },
  },
  resource: {
    apiVersion: 'resourcekit.dev/v1alpha1',
    kind: 'SelectableList',
    bindings: {
      selected: { $data: 'selectedHost' },
    },
    spec: {
      data: { $data: 'metrics' },
      primary: { field: 'name' },
      events: {
        select: { kind: 'setData', node: 'selectedHost', from: 'row.id' },
      },
    },
  },
}

const schema = buildResourceDocumentSchema(scope)
const validation = validateResourceDocument(document, scope)
```

`ResourceRenderer` accepts either a bare `Resource` or a `ResourceDocument`.
Its default store is in memory; hosts can provide a `DataStore` through the
`dataStore` prop to change physical persistence without changing document or
adapter contracts. Same-microtask writes are batched, downstream resolves use
latest-wins cancellation, and fan-in nodes observe a coherent propagation
wave.

The dataflow API is currently experimental. The v1 node vocabulary is limited
to `state` and `resolve`; there is no general transform DSL.

## Mutations and submit

Forms and editable kinds use a declarative `SubmitSpec`: an optional scoped
action name, a mutation binding, and success effects.

```json
{
  "action": "customer.update",
  "mutation": {
    "target": "rest",
    "url": "https://api.example.com/customers/${customerId}",
    "method": "PATCH"
  },
  "onSuccess": [
    { "kind": "emit", "event": "customer.updated" }
  ]
}
```

The runtime interpolates the binding, dispatches it to the registered mutation
resolver for `target`, applies success effects, and forwards emitted effects to
the host. The same flow is available headlessly through `runSubmit` and inside
kind renderers through `ctx.actions.submit`.

## Registered connections

Connections let documents refer to a server-owned connection UID instead of
embedding a base URL, DSN, or credentials.

```ts
import {
  createConnectionDataResolver,
  restConnectionAdapter,
} from '@loykin/resourcekit'

registry.use({
  name: 'connections',
  connectionAdapters: { rest: restConnectionAdapter },
  dataResolvers: {
    connection: createConnectionDataResolver(registry),
  },
})

registry.registerConnection({
  uid: 'crm-api',
  type: 'rest',
  name: 'CRM API',
  config: {
    baseUrl: 'https://api.example.com',
    headers: { authorization: 'Bearer <server-owned-token>' },
  },
  policy: {
    methods: ['GET'],
    pathPrefixes: ['/customers'],
  },
  mcpPolicy: {
    test: true,
    preview: true,
    mutate: false,
    maxRows: 20,
  },
})
```

Documents use only the UID and adapter-specific request:

```json
{
  "source": "connection",
  "connection": "crm-api",
  "request": {
    "path": "/customers/${customerId}"
  }
}
```

`ScopedRegistry.listConnections()` returns redacted `ConnectionSummary`
objects: metadata, request schema, and effective capabilities. It never returns
the connection's private `config`.

`registry.registerConnection(...)` covers connections known at boot time. A
host that keeps its own connections in a database can additionally register a
`ConnectionProvider` — the registry checks its static map first, then falls
back to the provider on lookup:

```ts
registry.setConnectionProvider({
  async getConnection(uid) {
    return loadConnectionFromDatabase(uid)
  },
  async listConnections() {
    return listConnectionsFromDatabase()
  },
})
```

`@loykin/resourcekit/adapters/datasourcekit` ships a second connection
adapter type, bridging a registered connection to a
[`@loykin/datasourcekit`](https://www.npmjs.com/package/@loykin/datasourcekit)
`DatasourceManager` instance (`test` → `healthCheck`, `inspect` →
`listNamespaces`/`listFields`, `validate` → `validateQuery`, `preview`/
`resolve` → `query`):

```ts
import { createDatasourceKitConnectionAdapter } from '@loykin/resourcekit/adapters/datasourcekit'

registry.use({
  name: 'datasourcekit-connections',
  connectionAdapters: { datasourcekit: createDatasourceKitConnectionAdapter(manager) },
})

registry.registerConnection({
  uid: 'metrics-main',
  type: 'datasourcekit',
  name: 'Metrics',
  config: { datasourceUid: 'metrics-main', datasourceType: 'postgres' },
})
```

## AI/MCP staged generation

For non-trivial registries, generate a document one position at a time instead
of sending one large recursive schema to a model:

```ts
import {
  buildResourceDocumentSchema,
  nextStage,
  nextStageBatch,
  singleKindSchema,
  validateResource,
} from '@loykin/resourcekit'

const root = nextStage(scope, {})
const slots = nextStageBatch(scope, {
  parent: { apiVersion, kind },
})
const kindSchema = singleKindSchema(scope, apiVersion, kind)
const validation = validateResource(resource, scope)
const documentSchema = buildResourceDocumentSchema(scope)
```

The orchestration loop is intentionally owned by the caller:

1. Call `nextStage(scope, {})` to obtain valid root candidates.
2. Pick a kind and call `singleKindSchema` for its full spec schema.
3. Call `nextStageBatch` for that node's slots. Insert `fixed` kinds directly
   and choose among candidates in `schema`.
4. Repeat steps 2–3 for every inserted child.
5. Validate the completed document with the same scope.

`buildDocumentSchema(scope)` remains available when a caller needs the full
recursive schema. The staged primitives usually produce smaller, more focused
model inputs.

### Editor support for hand-edited documents

Writing `buildDocumentSchema(scope)`'s output to a file and referencing it
from a document's own `$schema` field gives editors like VS Code inline
autocomplete and validation — the same workflow as a Kubernetes manifest:

```ts
import { writeFileSync } from 'node:fs'
writeFileSync('resourcekit-schema.json', JSON.stringify(buildDocumentSchema(scope), null, 2))
```

```json
{
  "$schema": "./resourcekit-schema.json",
  "apiVersion": "resourcekit.dev/v1alpha1",
  "kind": "Panel",
  "spec": { "title": "Customers" }
}
```

`$schema` is a recognized, optional `Resource` field — every generated
schema allows it without needing `additionalProperties` exceptions elsewhere.

See [`examples/mcp-server/`](./examples/mcp-server/) for a working MCP server
that exposes staged generation, connection discovery, request validation,
preview, and final document validation as tools.

## Custom kinds

A custom kind is an ordinary plugin manifest. The core contract stays
framework-free; React narrows only the manifest's render function.

```tsx
import type { ResourceKitPlugin } from '@loykin/resourcekit'
import type { KindRenderFn } from '@loykin/resourcekit/react'

export const appKinds: ResourceKitPlugin<KindRenderFn> = {
  name: 'app-kinds',
  kinds: [
    {
      apiVersion: 'example.com/v1',
      kind: 'Notice',
      level: ['leaf'],
      description: 'A short informational message.',
      specSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['message'],
        properties: {
          message: { type: 'string' },
        },
      },
      render: (resource) => (
        <aside>{String((resource.spec as { message: string }).message)}</aside>
      ),
    },
  ],
}
```

Register the plugin with `registry.use(appKinds)` and include the kind only in
scopes where it is supported.

## Development

```bash
pnpm install
pnpm dev          # library watch build + Vite playground
pnpm type-check
pnpm lint
pnpm test
pnpm build        # type-check + lint + package build
```

## License

MIT
