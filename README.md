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
pnpm add react react-dom react-hook-form @loykin/designkit
```

The kit and React packages are optional peer dependencies: headless consumers
do not need them, and applications can install only the adapters they use.

Tailwind CSS v4 consumers must import ResourceKit's source registration after
their design-system styles. Import only the adapter entries the application
actually uses:

```css
@import '@loykin/designkit/styles';
@import '@loykin/resourcekit/adapters/designkit/styles';
```

For the combined first-party adapter entry, use its matching combined source
registration:

```css
@import '@loykin/resourcekit/adapters/styles';
```

| Import | Purpose |
| --- | --- |
| `@loykin/resourcekit` | React-free core: registry, scoping, schema generation, validation, variables, object-state, scope registry, resolvers, connections, and submit runtime |
| `@loykin/resourcekit/react` | `ResourceRenderer` and React render contracts |
| `@loykin/resourcekit/adapters/designkit` | designkit kinds; form kinds use React Hook Form |
| `@loykin/resourcekit/adapters/gridkit` | gridkit kinds |
| `@loykin/resourcekit/adapters/chartkit` | chartkit kinds |
| `@loykin/resourcekit/adapters/basekit` | basekit kinds |
| `@loykin/resourcekit/adapters/datasourcekit` | `ConnectionAdapter` bridging registered connections to `@loykin/datasourcekit` |
| `@loykin/resourcekit/adapters` | All first-party kind adapters plus resource views; use when all required kit peers are installed. Connection adapters (e.g. `datasourcekit`) are not included — import them from their own subpath. |
| `@loykin/resourcekit/connectors/tanstack-query` | `QueryCoordinator` backed by `@tanstack/query-core` (optional peer) for real polling/caching/dedup |

The corresponding Tailwind v4 source entries are
`@loykin/resourcekit/adapters/designkit/styles`,
`@loykin/resourcekit/adapters/gridkit/styles`, and
`@loykin/resourcekit/adapters/basekit/styles`. The chartkit and datasourcekit
adapters add no ResourceKit-owned utility classes, so they need no ResourceKit
style entry; continue importing the underlying kit's own styles where required.

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

`ResourceRenderer` takes one `ResourceRendererProps` object. This example only
uses a few of them — the full set, most of which are covered in their own
sections below:

| Prop | Purpose |
| --- | --- |
| `resource` | A `Resource` — see [Named scopes](#named-scopes-sharing-a-fetch-across-sibling-kinds) for `scopeProvider`/`DataScope` |
| `registry` | A `ResourceRegistry` or (recommended) a `ScopedRegistry` |
| `runtimeStore` | Shared `RuntimeStore`; defaults to a private in-memory one — see [Named scopes](#named-scopes-sharing-a-fetch-across-sibling-kinds) |
| `runtimeScope` | Required alongside a shared `runtimeStore` unless the root has `metadata.name` |
| `queryCoordinator` | Routes a policy-bearing named scope through caching/polling/dedup instead of one-shot — see [Named scopes](#named-scopes-sharing-a-fetch-across-sibling-kinds) |
| `onAction` | Receives opaque `EventPolicy.kind: "action"` requests — see [Resource bindings, variables, and events](#resource-bindings-variables-and-events) |
| `onEvent` | Receives `emit` event policies and submit `emit` effects |
| `onDataError` | Receives resolve, coordinator, and unhandled action failures that have no other caller to reject to |
| `confirmDialog` | Handles `SubmitSpec.confirm`; a confirmed submit fails closed without it — see [Mutations and submit](#mutations-and-submit) |
| `renderUnknownKind` | Rendered for an unregistered kind |
| `renderLoading` | Rendered while a lazily-loaded kind's `render` is still loading, or a record-scope resource's first fetch hasn't resolved |
| `renderError` | Rendered when a record-scope resource's data fetch rejects |

## Resource model

Every node uses a Kubernetes-like envelope:

```ts
interface ScopeRef {
  $scope: string
  path?: string
}

interface ObjectStateRef {
  $state: string
  path?: string
}

interface VariableRef {
  $variable: string
}

type VisibilityCondition =
  | { $variable: string }
  | { $variable: string; equals: string }
  | { $variable: string; contains: string }
  | { $and: VisibilityCondition[] }
  | { $or: VisibilityCondition[] }
  | { $not: VisibilityCondition }

interface Resource<TSpec = unknown> {
  $schema?: string
  apiVersion: string
  kind: string
  metadata?: {
    name?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  spec: TSpec
  bindings?: Record<string, ObjectStateRef | VariableRef>
  visible?: VisibilityCondition
  disabled?: VisibilityCondition
  variables?: VariableDeclaration[]
  events?: Record<string, EventPolicy>
  objectState?: ObjectStateDeclaration[]
  record?: DataBinding | ObjectStateRef
  scope?: { name: string; binding: DataBinding; policy?: QueryPolicy }
  slots?: Array<{
    name?: string
    items: Resource[]
  }>
}
```

A minimal instance of that envelope — the actual JSON shape an AI/MCP client
emits, not a TypeScript value:

```json
{
  "apiVersion": "resourcekit.dev/v1alpha1",
  "kind": "DetailView",
  "bindings": {
    "selected": { "$variable": "customerId" }
  },
  "visible": { "$variable": "roles", "contains": "admin" },
  "spec": {
    "title": "Customer",
    "fields": [{ "field": "name", "label": "Name" }]
  }
}
```

- `apiVersion` and `kind` select a registered kind manifest.
- `bindings` connects kind-declared ports to a shared object-state slot or a
  flat variable. Adapters access those values only through the runtime
  context.
- `visible` conditionally renders the node from a flat page variable. The
  runtime owns this field, so kinds do not implement visibility themselves.
- `disabled` shares the same `VisibilityCondition` shape and evaluator as
  `visible`, but never gates rendering — the runtime evaluates it and exposes
  the result as `RenderContext.disabled` for kinds with a natural disabled
  affordance (buttons, inputs, submit actions) to consume.
- `variables`/`events`/`objectState`/`record`/`scope` are covered just below.
- `slots` belong to the parent. Omit `name` for the default slot.
- Each parent's `SlotPolicy` controls accepted child kinds and cardinality.
- A leaf kind has no slot policy and must not contain `slots`.

Parents never inspect child specs, and children never know which parent slot
contains them. Unknown or not-yet-loaded kinds degrade only that node to
`renderUnknownKind`; they do not crash the whole document.

`spec` is *not* where every generically-shaped value lives — the envelope
above carries the fields the runtime reads by fixed name regardless of kind
(`variables`/`events`/`objectState`/`record`/`scope`, alongside
`bindings`/`visible`/`disabled`), so a kind's own `specSchema` never needs a
same-named placeholder property for them. `spec` still has two tiers of its
own:

| Tier | Fields | Who reads it |
| --- | --- | --- |
| Shared vocabulary, kind-placed | e.g. `SubmitSpec` (`action`/`mutation`/`confirm`/`onSuccess`), `RowCondition` (`hideWhen`/`disabledWhen`), most kinds' own `data` binding (`DetailView`, `SelectableList`, `GridKitTable`, ...) | A kind's own render function chooses to read a field of this shape from wherever its own spec schema places it (`FormView` puts a `SubmitSpec` at `spec.submit`; `GridKitTable` puts one at `spec.columns.actions.items[].submit`) and pass it into a runtime-provided dispatcher (`ctx.actions.submit`, `ctx.bindings.write`, `ctx.data.resolve`) |
| Kind-owned | Everything else | Checked only against that kind's own `specSchema`; the runtime never looks inside it |

| Envelope field | Condition | Effect |
| --- | --- | --- |
| `variables` | Any resource, any kind | `VariableDeclaration[]`, scanned recursively across the whole document tree and auto-declared as flat (`string \| string[]`), read/write page variables |
| `events` | Only as a fallback when the kind manifest has no `behaviorPolicy.events[event]` for the fired event | Read as an `EventPolicy` map, keyed by event name |
| `objectState` | Any resource, any kind | `ObjectStateDeclaration[]`, scanned recursively — shared, writable, object-shaped state slots (the structured counterpart to `variables`; see `ObjectStateRef`/`Resource.bindings`) |
| `record` | Only when the kind's manifest sets `recordScope: true` | Read as a `DataBinding` (a real fetch) or an `ObjectStateRef` (a pointer to an `objectState` slot); the runtime resolves it into `RenderContext.record` before the kind renders |
| `scope` | Only when the kind's manifest sets `scopeProvider: true` | `{ name, binding, policy? }` — the runtime resolves `binding` (once, or repeatedly if `policy.refresh` is set) and publishes the raw result to every descendant as `{ "$scope": name }`, resolvable via `ctx.data.resolve` |

## Registry and adapters

The registry is a runtime plugin host. Plugins can contribute kind manifests,
data resolvers, mutation resolvers, and connection adapters — `registry.use()`
takes one `ResourceKitPlugin` object:

| Field | Purpose |
| --- | --- |
| `name` | Plugin identifier, for diagnostics only |
| `kinds` | `KindManifest[]` this plugin registers |
| `patternExamples` | Multi-kind pattern examples surfaced to `selectExamples()` for AI generation guidance |
| `dataResolvers` | `source` → `DataResolver` map dispatched by `spec.data`/`scope.binding` |
| `dataSourceAdapters` | Optional `queryKey`/schema enrichment for a `dataResolvers` source — without one, a `QueryCoordinator` falls back to `[nodeId, JSON.stringify(binding)]` as the cache key |
| `mutationResolvers` | `target` → `MutationResolver` map dispatched by `submit.mutation` |
| `connectionAdapters` | Connection *type* adapters (`rest`, `datasourcekit`, ...) — not connection instances, see [Registered connections](#registered-connections) |

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
AI/MCP client. It takes one `ScopeOptions` object — this is the entire host
ceiling in one place; nothing an AI/MCP client can reach lives outside it:

| Field | Purpose |
| --- | --- |
| `apiVersions` | Allowed `apiVersion` values |
| `kinds.include` / `kinds.exclude` | Allowed / denied kind names |
| `spec.pick` / `spec.omit` / `spec.lock` | Per-kind spec field allowlist, denylist, and fixed values |
| `slots.include` / `slots.exclude` | Per-kind allowed slot names |
| `variables.allow` / `variables.lock` | Allowed page variables and fixed values |
| `datasources.allow` | Allowed resolver `source` values |
| `actions.allow` | Allowed named actions — both `submit.action` and `EventPolicy.kind: "action"` |
| `connections.allow` / `connections.capabilities` | Allowed connection UIDs and the MCP capability ceiling (`test`/`inspect`/`preview`/`mutate`) applied to all of them |
| `maxDepth` | Maximum slot nesting depth |
| `rootLevels` | Allowed [levels](docs/kind-level-taxonomy.md) for the document root |
| `queryPolicy` | Host ceiling (`allowPolling`, `minIntervalMs`, `maxIntervalMs`, `maxRetries`) that clamps an AI-authored named scope's `QueryPolicy` before it reaches a `QueryCoordinator` — see [Named scopes](#named-scopes-sharing-a-fetch-across-sibling-kinds) |

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
  queryPolicy: {
    allowPolling: true,
    minIntervalMs: 2000,
    maxRetries: 2,
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
references, resolver registration, and datasource/action allowlists —
including that a `{ "$scope": "name" }` reference is only used where some
ancestor `scopeProvider: true` kind actually provides that name. Validate
every AI-produced document before rendering it.

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

The same dot-path convention (`rowsPath`, `valuePath`, event `from`) is
available standalone as `getValueAtPath`/`setValueAtPath` for a custom
resolver, mutation resolver, or kind adapter to reuse instead of
reimplementing path traversal.

`createRestResolver({ headers, fetchImpl })` builds a custom REST resolver
instead of using the default `restResolver`. `headers` is called before every
request and merged under the binding's own static `headers` (the binding
wins on conflict) — use it to attach auth that would go stale if baked into
the document, e.g. a JWT refreshed out-of-band. `fetchImpl` swaps the
underlying `fetch` (custom transport, tests).

```ts
import { createRestResolver } from '@loykin/resourcekit'

registry.use({
  name: 'core-data-resolvers',
  dataResolvers: {
    rest: createRestResolver({ headers: () => ({ authorization: `Bearer ${getCurrentToken()}` }) }),
  },
})
```

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
  "events": {
    "select": {
      "kind": "setVariable",
      "variable": "customerId",
      "from": "row.id"
    }
  }
}
```

The React runtime applies `setVariable` policies and forwards `emit`
policies through `ResourceRenderer`'s `onEvent` callback. A writable port
writes through `ctx.bindings.write`; adapters never own a parallel
integration store. `internal` behavior stays inside the kind. After the
scoped action allowlist is checked, `action` crosses the React host boundary
as an opaque request. ResourceKit does not interpret, register, or execute
adapter-specific actions:

```tsx
<ResourceRenderer
  registry={scope}
  resource={document}
  onAction={async ({ action, payload }) => {
    if (action === 'process.restart') await restartProcess(payload)
  }}
/>
```

An action with no host handler is reported through `onDataError` instead of
silently pretending that it ran. The request carries the renderer's `scope`
and originating resource, so a host can isolate pages and route it through
its own adapter-specific registry if needed.

Nodes can reactively opt into rendering through the runtime-owned `visible`
field, and mark themselves disabled — without hiding — through the parallel
`disabled` field:

```json
{
  "apiVersion": "resourcekit.dev/v1alpha1",
  "kind": "Panel",
  "visible": { "$variable": "roles", "contains": "admin" },
  "spec": { "title": "Administration" }
}
```

```json
{
  "apiVersion": "resourcekit.dev/v1alpha1",
  "kind": "Button",
  "disabled": { "$not": { "$variable": "roles", "contains": "admin" } },
  "spec": { "label": "Delete" }
}
```

`{ "$variable": "name" }` uses string truthiness or a non-empty array.
`equals` compares a string variable, while `contains` checks membership in a
`string[]` variable. Conditions compose recursively with `$and`/`$or`/`$not`,
e.g. `{ "$or": [{ "$variable": "roles", "contains": "admin" }, { "$variable": "roles", "contains": "operator" }] }`.
Generated scoped schemas and runtime validation both enforce the scope's
variable allowlist for `visible` and `disabled` alike.

`visible` gates whether a node renders at all; `disabled` never does — it is
only forwarded to the kind as `RenderContext.disabled`, so a kind with no
natural disabled affordance (a chart, a text block) can simply ignore it.
Like `visible`, this is a rendering hint, not authorization: a disabled
button is still just UX, and only the backend's own authorization enforcement
can actually block the underlying request. `disabled` is unrelated to
`GridKitTable`'s row-action `hideWhen`/`disabledWhen` (see
[Grid row actions](#grid-row-actions)) — those compare a row's own field
value, a data source the runtime has no access to, so they keep their own
`RowCondition` shape instead of `VisibilityCondition`.

## Named scopes: sharing a fetch across sibling kinds

Most kinds fetch through their own `spec.data` binding directly — no extra
mechanism needed, and `${variable}` interpolation already covers "refetch
when a page variable changes". A named **scope** only earns its keep for the
one thing a plain binding can't do: letting two *unrelated* sibling kinds
(e.g. a compact selector and a full table showing the same list) share one
fetch, or letting a mutation's `refetchData`/`invalidateData` effect target
it by a stable name regardless of where it lives in the tree.

A `scopeProvider: true` kind (`DataScope` is the built-in one) resolves
`resource.scope.binding` — once, or repeatedly if `scope.policy.refresh` is
set — and publishes the raw result to every descendant as
`{ "$scope": "name" }`, resolvable through the same `ctx.data.resolve` every
kind already uses for its own `spec.data`:

```json
{
  "apiVersion": "resourcekit.dev/v1alpha1",
  "kind": "DataScope",
  "variables": [{ "name": "selectedHost", "default": "web-1" }],
  "scope": {
    "name": "hostCpu",
    "binding": {
      "source": "connection",
      "connection": "metrics",
      "request": { "operation": "metrics", "cluster": "us-east" }
    }
  },
  "spec": {},
  "slots": [
    {
      "items": [
        {
          "apiVersion": "resourcekit.dev/v1alpha1",
          "kind": "SelectableList",
          "bindings": { "selected": { "$variable": "selectedHost" } },
          "spec": { "data": { "$scope": "hostCpu" }, "primary": { "field": "host" } },
          "events": { "select": { "kind": "setVariable", "variable": "selectedHost", "from": "row.host" } }
        },
        {
          "apiVersion": "resourcekit.dev/v1alpha1",
          "kind": "TableView",
          "spec": { "data": { "$scope": "hostCpu" }, "columns": { "host": { "label": "Host" } } }
        }
      ]
    }
  ]
}
```

Both `SelectableList` and `TableView` read the *same* fetched value — one
request, shared by both. The value flows down through ordinary React
props/render-tree recursion, the same way `record` flows to descendants of a
`recordScope: true` kind — there is no separate shared store for this part.

The only piece that *does* need a shared, tree-position-independent handle is
letting a mutation's `onSuccess` effect (`invalidateData`/`refetchData`,
`scopes: [...]`) reach a named scope provider mounted anywhere else in the
tree. That's a thin in-memory registry, not a dependency graph — no
generations, no epochs, no cascade: naming a scope in `refetchData` re-runs
exactly that scope's own fetch, nothing implicitly downstream of it.

```json
{
  "submit": {
    "mutation": { "target": "operations", "connection": "service-operations" },
    "onSuccess": [{ "kind": "refetchData", "scopes": ["incidents", "incidentDetail"] }]
  }
}
```

A `scope.policy` carries an AI-authored `QueryPolicy` — `refresh: { kind:
'interval', ms }`, `staleForMs`, `retainPreviousData`, `retry: { maxAttempts
}` — using resourcekit-generic vocabulary, never a specific query library's
option names. A host clamps it against its own `QueryScopePolicy` ceiling
(`allowPolling`, `minIntervalMs`/`maxIntervalMs`, `maxRetries`) with
`clampQueryPolicy(policy, scope)` before running it; this never rejects, it
only narrows an AI-authored policy down to what the host already allows.

A policy-bearing scope routes its fetch through a swappable
`QueryCoordinator` boundary instead of talking to a data resolver directly.
`createDirectQueryCoordinator()` does one-shot resolves with no cache,
polling, dedup, or retry. TanStack Query hosts can install
`@tanstack/query-core` and use the supplied connector with their existing
`QueryClient`:

```ts
import { createTanStackQueryCoordinator } from '@loykin/resourcekit/connectors/tanstack-query'

const coordinator = createTanStackQueryCoordinator(queryClient)

<ResourceRenderer
  resource={resource}
  registry={scope}
  queryCoordinator={coordinator}
/>
```

Use the application's existing `QueryClient`. A data source adapter's
`queryKey` determines cache identity; `refetchData` names the scope, and the
connector maps it back to its active Query observer. This is the
integration shape used by Piper-like hosts — ResourceKit owns which named
scope exists and where its value flows, while TanStack Query owns
server-state caching and scheduling.

An explicit `refetchData` submit effect forces a fresh fetch through the
scope's own coordinator handle (or, with no coordinator, bypasses
`resolveThroughRuntime`'s cache) and publishes the new value into the
mounted `DataScope` instance's own state.

`invalidateData` only marks the coordinator cache (or the scope's published
snapshot) stale; it does not execute a request. Use `refetchData` when the
mutation must wait for fresh server data.

`ResourceRenderer`'s default `RuntimeStore` is in memory; hosts can provide
one through the `runtimeStore` prop. This is the common namespaced KV
snapshot/watch plane underlying page variables, object-state slots, named
scopes' change notifications, and named executions. Consumers opt into exact
keys or namespaces; the store does not own their subscription policy. A
shared store must pair each renderer with a unique `runtimeScope` (or a root
`metadata.name`) so pages do not collide. The common runtime stops at
storing snapshots and notifying subscribers — it contains no adapter action
registry or command semantics of its own.

## Mutations and submit

Forms, editable kinds, and row actions use one declarative `SubmitSpec`: an
optional scoped action name, a mutation binding, an optional confirmation,
and success effects.

```json
{
  "action": "customer.delete",
  "mutation": {
    "target": "rest",
    "url": "https://api.example.com/customers/${payload.id}",
    "method": "DELETE"
  },
  "confirm": {
    "title": "Delete ${payload.name}?",
    "description": "This cannot be undone."
  },
  "onSuccess": [
    { "kind": "invalidateData", "scopes": ["customers"] },
    { "kind": "emit", "event": "customer.deleted" }
  ]
}
```

Page variables use `${variableName}`. Submit payload fields use an explicit
`${payload.id}` or nested `${payload.customer.id}` namespace. Mutation
bindings and confirmation copy both support these references; unresolved
references fail before confirmation or mutation.

The submit runtime checks the scoped action allowlist, resolves references, verifies
the mutation resolver and confirmation handler, waits for confirmation,
executes the mutation, and only then applies success effects through the
variable engine, scope registry, object-state engine, and runtime store that own those values. A declared
confirmation fails closed when the host does not provide
`ResourceRenderer.confirmDialog`:

```tsx
<ResourceRenderer
  registry={scope}
  resource={resource}
  confirmDialog={({ title, description }) => openApplicationDialog({ title, description })}
/>
```

The callback returns `Promise<boolean>`. Cancellation does not call the
mutation resolver or apply effects; `runSubmit`/`ctx.actions.submit` returns
the exported `SUBMIT_CANCELLED` sentinel. Successful submits keep returning
the mutation resolver's result. Form adapters suppress their success message
after cancellation. Repeated form controls with the same name are submitted
as an array rather than losing all but one value. Headless callers provide the
same confirmation callback through `SubmitRuntime.confirm`.

`setVariable` and `emit` work on any resource. `invalidateData`/`refetchData`
name one or more `scope.name`s to mark stale or force a fresh fetch on —
see [Named scopes](#named-scopes-sharing-a-fetch-across-sibling-kinds).

### Controlled FormView drafts

`FormView` is backed by React Hook Form and can optionally connect its `draft`
binding port to a writable, shared `objectState` slot. Without this binding
RHF keeps values local to the form. A controlled draft is an identity-bearing
envelope. A new identity always resets the form; a same-identity refresh
preserves dirty edits. This distinguishes record navigation from polling
without asking the form to infer host intent.

```ts
const resource: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'FormView',
  objectState: [
    {
      name: 'processDraft',
      initialValue: {
        identity: 'process-7',
        value: {
          id: 'process-7',
          command: 'nginx -g daemon off;',
          name: 'nginx',
        },
      },
    },
  ],
  bindings: {
    draft: { $state: 'processDraft' },
  },
  spec: {
    sections: [
      {
        id: 'main',
        fields: [
          { name: 'command', label: 'Command', required: true },
        ],
      },
    ],
    draftPolicy: {
      syncDelayMs: 100,
      markCleanOnSuccess: true,
    },
    submit: {
      action: 'process.update',
      mutation: { target: 'process-api' },
    },
  },
}
```

The example assumes the host registered a `process-api` mutation resolver.
The mutation receives only the envelope's `value`, not `identity`.
`markCleanOnSuccess` adopts the submitted payload as the new clean baseline;
it does not clear the form.

RHF's `formState.isSubmitting` and root errors drive the form's pending/error
UI. The resource runtime continues to own mutation orchestration and success
effects; it does not duplicate RHF's form lifecycle in a parallel store.

`ResourceForm` also uses React Hook Form: its composed Input/Textarea/
Checkbox/Select children register through an RHF `FormProvider`. The shared
`draft` binding currently applies only to `FormView`; `ResourceForm` keeps
its RHF values local until submit.

Use a new envelope identity for an explicit reset or record switch. Same-key
multi-writer conflict policy belongs to the host or adapter that chooses to
subscribe to that key; `RuntimeStore` deliberately does not assign ownership.
An `undefined` or `null` controlled value is treated as hydration readiness.
A non-null malformed envelope is reported inside that `FormView` and draft
synchronization remains disabled; it does not fail the surrounding document.

### Grid row actions

`GridKitTable` (alias `TableView`) supports an action column through
`display: "actions"`. Each item must choose exactly one of `event` or
`submit`; submit items use the same contract as forms and receive the complete
`row.original` object as their payload. Event items route their event name
through the table's normal envelope `events` policy map.

```json
{
  "apiVersion": "resourcekit.dev/v1alpha1",
  "kind": "GridKitTable",
  "spec": {
    "data": { "source": "rest", "url": "/api/users" },
    "columns": {
      "name": { "label": "Name" },
      "actions": {
        "label": "",
        "display": "actions",
        "items": [
          {
            "id": "delete",
            "label": "Delete",
            "variant": "destructive",
            "disabledWhen": { "field": "role", "equals": "Admin" },
            "submit": {
              "action": "users.delete",
              "mutation": {
                "target": "rest",
                "url": "/api/users/${payload.id}",
                "method": "DELETE"
              },
              "confirm": { "title": "Delete ${payload.name}?" }
            }
          }
        ]
      }
    }
  }
}
```

`data` is required on every `GridKitTable` spec, same as any other data-bound
kind — `columns` (and its `actions` entry) is the part this section adds.

`hideWhen` and `disabledWhen` compare a dot-path field from the row with an
`equals` value. These are presentation rules, not authorization; mutation
resolvers and backends must enforce permissions. Action button clicks stop
propagation so they do not also trigger the grid's row-selection behavior.
The playground's **User management** sample demonstrates the full
row-action → confirmation → in-memory mutation → reactive refetch flow. It
uses `window.confirm` only as a self-contained host implementation; production
applications should inject their own accessible application dialog.

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
    timeoutMs: 5000,
    maxResponseBytes: 1_000_000,
  },
})
```

`timeoutMs` aborts the request once it elapses; `maxResponseBytes` stops
reading the response body (and rejects) once it's exceeded, before the whole
payload is buffered. Both apply to `resolve` (the render-path fetch), not
just `preview` (the MCP inspection path) — a connection with no
`timeoutMs`/`maxResponseBytes` set has neither limit.

Like `createRestResolver`, `createRestConnectionAdapter({ headers, fetchImpl })`
accepts a dynamic `headers` callback (merged under the connection's own
`config.headers`, which wins on conflict) and a `fetchImpl` override, in place
of the default `restConnectionAdapter`.

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

## Full example: wiring it together

Each piece above is introduced where it becomes relevant. This section wires
them into one realistic app — reusing the `crm-api` connection and `roles`
variable from the sections above — so it's clear how they actually connect,
not just what each one does in isolation.

### 1. Registry: plugins, resolvers, connections

```ts
const registry = createRegistry<KindRenderFn>()
registry.use(createDesignKitPlugin())
registry.use(createGridKitPlugin())
registry.use({
  name: 'connections',
  connectionAdapters: { rest: restConnectionAdapter },
  dataResolvers: { connection: createConnectionDataResolver(registry) },
})
registry.use({
  name: 'app-mutations',
  mutationResolvers: { rest: myRestMutationResolver },
})

registry.registerConnection({
  uid: 'crm-api',
  type: 'rest',
  name: 'CRM API',
  config: { baseUrl: 'https://api.example.com' },
  policy: { methods: ['GET', 'DELETE'], pathPrefixes: ['/customers'] },
  mcpPolicy: { test: true, preview: true, mutate: false },
})
```

### 2. Scope: the host ceiling exposed to AI/MCP

```ts
const scope = registry.scope({
  apiVersions: ['resourcekit.dev/v1alpha1'],
  kinds: { include: ['Panel', 'TableView'] },
  variables: { allow: ['roles'] },
  actions: { allow: ['customer.delete'] },
  connections: {
    allow: ['crm-api'],
    capabilities: { test: true, preview: true, mutate: false },
  },
  queryPolicy: { allowPolling: true, minIntervalMs: 5000 },
  rootLevels: ['template'],
  maxDepth: 4,
})
```

### 3. Document: a named scope, visibility, and a submit row action

This is the actual JSON payload an AI/MCP client emits (validated with
`validateResource(resource, scope)` before it ever reaches
`ResourceRenderer`) — not a TypeScript value. `customers` is wrapped in a
`DataScope` here not because two sibling kinds share it (only `TableView`
reads it in this example) but because the delete mutation below needs to
target it by name with `refetchData`:

```json
{
  "apiVersion": "resourcekit.dev/v1alpha1",
  "kind": "DataScope",
  "scope": {
    "name": "customers",
    "binding": {
      "source": "connection",
      "connection": "crm-api",
      "request": { "path": "/customers" }
    },
    "policy": { "refresh": { "kind": "interval", "ms": 5000 } }
  },
  "spec": {},
  "slots": [
    {
      "items": [
        {
          "apiVersion": "resourcekit.dev/v1alpha1",
          "kind": "Panel",
          "visible": { "$variable": "roles", "contains": "admin" },
          "variables": [{ "name": "roles", "type": "string[]" }],
          "spec": { "title": "Customers" },
          "slots": [
            {
              "items": [
                {
                  "apiVersion": "resourcekit.dev/v1alpha1",
                  "kind": "TableView",
                  "spec": {
                    "data": { "$scope": "customers" },
                    "columns": {
                      "name": { "label": "Name" },
                      "actions": {
                        "label": "",
                        "display": "actions",
                        "items": [
                          {
                            "id": "view",
                            "label": "View",
                            "event": "view"
                          },
                          {
                            "id": "delete",
                            "label": "Delete",
                            "variant": "destructive",
                            "submit": {
                              "action": "customer.delete",
                              "mutation": {
                                "target": "rest",
                                "url": "/customers/${payload.id}",
                                "method": "DELETE"
                              },
                              "confirm": { "title": "Delete ${payload.name}?" },
                              "onSuccess": [
                                { "kind": "refetchData", "scopes": ["customers"] },
                                { "kind": "emit", "event": "customer.deleted" }
                              ]
                            }
                          }
                        ]
                      }
                    }
                  },
                  "events": {
                    "view": { "kind": "emit", "event": "customer.viewRequested" }
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

`Panel`'s `variables` declares `roles` so the document is self-contained (a
real AI-authored document must declare every variable it references, not
just use it). `TableView`'s row action uses the `event` variant (see
[Grid row actions](#grid-row-actions)) instead of `submit` — its event name
routes through the table's own `events`, which is envelope content (a
sibling of `spec`), not a `spec` field, exactly like `Panel`'s `visible`
above reads `roles` from the envelope.

`record` (a fifth envelope field, alongside `variables`/`events`/
`bindings`/`visible`/`scope`) only applies to a `recordScope: true` kind — it
doesn't fit naturally into this list/delete flow, so here it is in
isolation, resolving one customer directly by ID instead of through the
`customers` scope above:

```json
{
  "apiVersion": "resourcekit.dev/v1alpha1",
  "kind": "RecordScope",
  "record": {
    "source": "connection",
    "connection": "crm-api",
    "request": { "path": "/customers/${customerId}" }
  },
  "spec": {},
  "slots": [
    {
      "items": [
        {
          "apiVersion": "resourcekit.dev/v1alpha1",
          "kind": "DataBody",
          "spec": { "title": "Customer" },
          "slots": [
            {
              "items": [
                {
                  "apiVersion": "resourcekit.dev/v1alpha1",
                  "kind": "DataBodyGroup",
                  "spec": {},
                  "slots": [
                    {
                      "items": [
                        {
                          "apiVersion": "resourcekit.dev/v1alpha1",
                          "kind": "DataBodyField",
                          "spec": { "label": "Name", "fieldRef": "name" }
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

`RecordScope`'s own `slotPolicy` only accepts `DataBody`/`ResourceForm`
directly — a leaf like `DataBodyField` has to nest inside one of those (here
`DataBody` → `DataBodyGroup` → `DataBodyField`) to reach the record scope.
`DataBodyField` has no `data`/`bindings` of its own; its `fieldRef` is a
dot-path read from the nearest ancestor's `record`, not a resolver binding.

The host loads this JSON as a typed `Resource` — nothing above is
TypeScript-only syntax, `${...}` interpolation and all:

```ts
const resource: Resource = resourceJson
```

### 4. Render: every `ResourceRendererProps` field earning its place

```tsx
const runtimeStore = createMemoryRuntimeStore()
const coordinator = createTanStackQueryCoordinator(queryClient)

<ResourceRenderer
  resource={document}
  registry={scope}
  runtimeStore={runtimeStore}
  runtimeScope="customers-page"
  queryCoordinator={coordinator}
  confirmDialog={(options) => Promise.resolve(window.confirm(options.title))}
  onEvent={(event) => {
    if (event === 'customer.deleted') toast('Deleted')
  }}
  onDataError={(error, node) => reportError(error, { node })}
  renderUnknownKind={(node) => <p>Unsupported kind: {node.kind}</p>}
  renderLoading={() => <p>Loading…</p>}
  renderError={(error) => <p>{String(error)}</p>}
/>
```

Tracing one interaction through this: `roles` — a page variable the host sets
from its own auth context after login — gates the whole `Panel` through
`visible`. `customers` polls every 5s through the TanStack coordinator wired
in step 4, clamped to the `queryPolicy` ceiling set in step 2. Clicking
**Delete** is checked against `actions.allow` from step 2, confirms through
`confirmDialog`, runs the `customer.delete` mutation through the `rest`
mutation resolver registered in step 1, then refetches `customers` and emits
`customer.deleted`, which `onEvent` turns into a toast.

This particular document has no `EventPolicy.kind: "action"` node, so
`onAction` never fires here — see
[Resource bindings, variables, and events](#resource-bindings-variables-and-events)
for the opaque host-action path that takes instead of a `submit` when a kind
needs to reach adapter-specific, non-mutation host behavior.

## AI/MCP staged generation

For non-trivial registries, generate a document one position at a time instead
of sending one large recursive schema to a model:

```ts
import {
  buildDocumentSchema,
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
const documentSchema = buildDocumentSchema(scope)
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

A document a person hand-edits is source code shared with an LLM, which
raises two more concerns a host's own regeneration loop should handle:

- **Preserving human edits across full regeneration.** `markLocked(resource)`
  sets the `resourcekit.dev/locked` annotation
  (`LOCKED_ANNOTATION`/`isLocked`); `preserveLockedNodes(previous, next)`
  then carries locked nodes forward from `previous` into a freshly
  regenerated `next` document, matched by `apiVersion`/`kind`/
  `metadata.name`. This is "keep what a human locked on a full rewrite," not
  a patch/diff format — an unnamed node, or one the LLM dropped from `next`
  entirely, cannot be reliably matched and is not preserved.
- **Diff-stable serialization.** LLM output varies in key order and
  explicit-`undefined` fields between otherwise-identical documents, which
  turns `git diff` into noise. `canonicalizeJson`/`canonicalizeResource`
  deep-sort object keys and drop `undefined` values (arrays keep their
  order); `canonicalStringify(value, space)` canonicalizes and serializes in
  one call. Apply this before a human reviews an LLM-produced diff.

Both are standalone host-facing primitives — nothing in resourcekit's core
or examples calls them automatically.

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

A `KindManifest` has two more opt-in flags beyond what the example above
uses:

- `recordScope: true` resolves the kind's own `spec.data` binding to its
  first row and publishes it to descendants as `ctx.record` (`RenderContext`)
  — a nearest-ancestor scope, not a prop, so a deeply nested field-rendering
  kind can read from it by dot-path without the parent passing anything
  through slots. `DetailView`-style "one record, many mapped fields" kinds
  are built on this.
- `hostAuthoredOnly: true` makes `registry.scope()` drop the kind
  unconditionally from the AI-facing schema — even if a scope's
  `kinds.include` names it explicitly. The kind still renders normally when a
  host hand-authors it into a document; this only closes it off from AI/MCP
  generation. Use it for a kind whose spec is itself schema-*shaped* rather
  than schema-*conforming* (e.g. an open `jsonSchema` property a generator
  could otherwise use to define an arbitrary field set, bypassing the
  reviewable kind catalog `kinds.include` exists to enforce).

### Kind examples and generation quality

`KindManifest.examples` (`KindExample[]`, each `{ description?, resource }`)
and `ResourceKitPlugin.patternExamples` (`PatternExample[]`, each adding a
`name`) are the "this kind/pattern is used like this" teaching unit for
AI/MCP generation — a multi-kind pattern example teaches composition
topology (master-detail, filter + table, form + submit) that no single
kind's schema can. Examples are test fixtures as much as documentation:
`validateAllExamples(registry)` runs every registered example through
`validateResource` and reports failures, so CI catches an example rotting out
from under an evolving schema instead of it silently going on teaching an AI
(or a human) something that no longer works.

`ScopedRegistry.selectExamples()` returns only the examples a given scope
actually allows — already filtered by `kinds.include` and re-validated
against that scope — for assembling into a generation prompt. Never hand an
AI/MCP client examples pulled from the unrestricted registry, for the same
reason as the schema itself.

## Playground examples

The playground separates its examples by what they prove:

- **AI scenario** — a fixture graded against a scenario-specific generation scope.
- **MCP generated** — a document produced through an MCP tool-calling session and validated before inclusion.
- **Runtime demo** — a hand-authored integration example for rendering, dataflow, mutation, or event behavior.
- **Component fragment** — a renderable embed whose root is intentionally not eligible in a full-page `rootLevels: ['template']` scope.

Each example carries its own scope. The playground uses that same scope for
root selection, staged slot replay, final `validateResource`, and rendering.
The composition panel reports the final validation result and does not
present runtime or fragment examples as evidence of an MCP generation
session.

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
