# resourcekit — AI Agent Instructions

## Project Overview

- **Package**: `@loykin/resourcekit`
- **Purpose**: Declarative resource runtime for Loykin kits. An AI/MCP agent
  emits a JSON resource document; the application validates it and renders it
  with its own design system (designkit, gridkit, chartkit, basekit).
- **Monorepo**: root (library), `playground/` (Vite dev server)

## Design Rules

The runtime follows a Kubernetes-like resource model: `apiVersion`/`kind`
identify a node, `slots` are parent-owned placement groups holding child
resources. Ownership boundaries are strict — the runtime owns kind lookup,
recursion, slot rendering, fallback, validation dispatch, and binding
dispatch; each kind owns its spec schema, slot policy, and prop mapping.
Leaf kinds never know which parent slot they are in; parents never read
child specs.

`spec` is *not* uniformly kind-owned. The common envelope (sibling to
`bindings`/`visible`/`disabled`) carries fields the runtime reads by fixed
name regardless of kind: `variables` (flat, page-level `string | string[]`
declarations, scanned recursively — the only shared/writable value
mechanism for scalars), `events` (fallback `EventPolicy` map when a kind's
own `behaviorPolicy.events` doesn't cover the fired event), `objectState`
(shared, writable, object-shaped state slots — the structured counterpart to
`variables`, read/written via `ObjectStateRef`/`{"$state": name}`), `record`
(only for a `recordScope: true` kind — resolved into `ctx.record`; a
`DataBinding` fetch or an `ObjectStateRef` pointer), and `dataflow` (a flat
array of named data-fetch units — `{name, binding, policy?, dependOn?}` —
scanned recursively across the whole document, same footing as `variables`;
available on every kind, no manifest flag gates it). Never add a same-named
placeholder property to a kind's own `specSchema` for these — they live on
the envelope, not in `spec`. Everything else in `spec` is either kind-owned
outright, or a shared vocabulary type (`SubmitSpec`, `DataBinding`) that the
kind itself chooses where to place and read (e.g. most kinds' own
`spec.data`, `spec.submit`).

Beyond rendering, the runtime provides (all optional, additive to a bare
`Resource`): a document-level `dataflow` layer — named, document-wide
data-fetch units resolved via `{"$dataflow": name}` from anywhere in the
tree, tree-position-independent (not tied to render structure the way
`record` is), owned by a single `DataflowEngine` per `ResourceRenderer`
mount (one fetch-owner per name, no per-mount registry), resolved through a
swappable `QueryCoordinator` boundary for caching/polling when a unit's
`policy` is set; a `submit`/mutation dispatch path whose `refetchData`/
`invalidateData` effects call the `DataflowEngine`'s own `refetch`/
`invalidate` methods directly by name; a common `RuntimeStore` (namespaced
KV + watch plane underlying variables/objectState/dataflow/execution — see
`src/runtime/store.ts`) that never assigns meaning to what's stored; and an
opaque host-action boundary (`EventPolicy.kind: "action"` → allowlist check
→ `ResourceRenderer.onAction`, never interpreted or executed by ResourceKit
itself). `src/dataflow/` holds everything dataflow-related: the engine
itself, always-bundled REST/DSN resolvers (no credential storage), the
generic `QueryCoordinator` contract, and optional third-party coordinator
integrations (e.g. TanStack Query) under `src/dataflow/coordinators/*`,
shipped from their own subpath.

A `dataflow` unit's `dependOn` is execution-order/lazy-gating ONLY — a unit
waits until every named unit in `dependOn` has reached `ready` before it
attempts its own fetch. It never carries a value: a unit's `binding` must
never reference another unit's resolved value (no value-chaining, no
document-level dependency *value* graph) — chained/cascading *value*
dependencies still belong to dashboardkit, same boundary as the flat
variable engine below. Only execution ordering moved into resourcekit.

A local working document (`docs/loykin-resource-runtime.md`, intentionally
untracked) may exist with the full specification narrative. If present,
treat it as design context; the committed source of truth is this file plus
the types and tests in `src/`.

## Commands

```bash
pnpm install        # workspace install (root + playground)
pnpm build          # type-check + lint + tsup
pnpm dev            # tsup --watch + playground dev server
pnpm type-check     # tsc --noEmit
pnpm lint           # eslint
pnpm test           # vitest run
```

## Architecture

Public package entries:

- `src/index.ts` (`.`) — **headless core**. No React imports anywhere under
  this entry. Types, registry/plugin host, validation, schema generation +
  scoping, variable engine, object-state engine, `DataflowEngine`,
  `RuntimeStore`, `QueryCoordinator`, `rest`/`static` data resolvers,
  connection resolvers.
- `src/react/index.ts` (`./react`) — the only place React types may appear.
  Recursive `ResourceRenderer`, `RenderContext`, unknown-kind fallback.
- `src/adapters/index.ts` (`./adapters`) — combined first-party kind adapters
  and resource-view kinds.
- `src/adapters/{designkit,gridkit,chartkit,basekit}/index.ts`
  (`./adapters/*`) — per-kit adapter entries so consumers install only the
  kit peers they use.
- `src/adapters/datasourcekit/index.ts` (`./adapters/datasourcekit`) —
  `ConnectionManifest` bridging a registered connection to `@loykin/datasourcekit`.
- `src/dataflow/` — the consolidated home for everything dataflow-related:
  `engine.ts` (`DataflowEngine`), `ref.ts` (`DataflowRef` scanning),
  `resolvers.ts`/`connectionManifests.ts` (always-bundled REST/DSN resolvers,
  no extra dependency), `coordinator.ts` (the generic `QueryCoordinator`
  contract + direct implementation), and
  `coordinators/tanstack-query/index.ts` (`./dataflow/tanstack-query`) —
  an optional third-party `QueryCoordinator` backed by `@tanstack/query-core`.
  Distinct from `src/adapters/*` (kind/UI adapters) — `src/dataflow/` is
  about how data gets fetched, `src/adapters/*` is about how it gets
  rendered.

Current state: the core engine (registry, validation, scoped schema
generation, variable engine, object-state engine, resolvers) and the React
renderer are implemented and unit-tested. First-party kind adapters ship
from resourcekit adapter subpaths and are exercised by the playground and
MCP server example.

## Hard Rules

- Core must remain React-free. If a core feature seems to need React types,
  the design is wrong — stop and reconsider.
- The `datasource` resolver ships as a datasourcekit adapter package, never
  in core. Core knows only the `DataBinding` envelope and its
  `apiVersion`/`kind` discriminator.
- Every adapter-registered concept — kinds, data sources, mutation sources,
  connection types — shares one envelope: `{apiVersion, kind, ...}`,
  registered as an array of self-describing manifests and looked up by
  `(apiVersion, kind)`, never a bare string key or a flat
  `Record<string, T>`. `DataBinding`/`MutationBinding` mirror this exactly
  (`{apiVersion, kind, spec}`, matching `Resource`'s own envelope) —
  `DataSourceManifest`/`MutationSourceManifest`/`ConnectionManifest` are the
  registration-side counterpart to `KindManifest`. If a new adapter-registered
  concept comes up, give it this same shape; don't reintroduce a
  bare-string-keyed `Record<string, T>` registration or a flat
  `{ <discriminator>: string, ...fields }` wire shape.
- Kind adapters map resource specs onto existing kit public props. Existing
  kit APIs (designkit, gridkit, chartkit, basekit) must not change.
- The variable engine stays flat: one page scope, `string | string[]`
  values. Chained variables, options queries, and dependency DAGs belong
  to dashboardkit — if you find yourself adding them here, stop.
- MCP/AI must only ever receive a scoped schema (`registry.scope(...)`),
  never the full registry schema.
- Unknown or not-yet-loaded kinds degrade that node to a fallback; they must
  never fail the whole document.
- Phase 0 code must be testable without a DOM (vitest, node environment).
- A `QueryCoordinator`'s `invalidate()` only marks cache entries stale — it
  never executes a request. `refetch()` is the only path that forces
  execution. Both `createDirectQueryCoordinator` and the TanStack connector
  must keep this split; don't let `invalidate` become a re-fetch shortcut.
- `DataflowEngine` (`src/dataflow/engine.ts`) is the only coordinator-aware
  point and the sole fetch-owner per named unit — there is no per-mount
  registration side-table; `refetch`/`invalidate` are plain method calls on
  this one instance, called directly by `SubmitEffect` handling and by
  `ctx.data.resolve`'s `DataflowRef` reads.
- `RuntimeStore` (`src/runtime/store.ts`) is a common namespaced KV/watch
  plane. It stores snapshots and notifies subscribers and nothing else — it
  must never gain an adapter action registry, command semantics, or
  namespace-specific behavior. Each namespace's owner (variables,
  object-state, dataflow, submit, a plugin) decides what its own keys mean.
  `DataflowEngine` publishes status/value *snapshots* into the store's
  `dataflow` namespace (that's fine — it's a snapshot), but its `refetch`/
  `invalidate` methods themselves never go through the store — that's
  command semantics, not a snapshot.
- `spec`'s `data`/`events`/`variables`-shaped placeholders must not be
  reintroduced. If a new runtime-owned, kind-independent concern comes up,
  it belongs on the `Resource` envelope (like
  `variables`/`events`/`objectState`/`record`/`dataflow`), not inside a
  kind's `specSchema` under a well-known name.
- A `dataflow` unit's `binding` is a single fetch — it must never gain a way
  to reference another unit's resolved *value* (no document-level value
  graph, no multi-hop value chaining). `dependOn` may express
  execution-order/lazy-gating between units, but never carries a value.
  Sharing across sibling kinds works through the flat, document-wide
  `{"$dataflow": name}` ref, tree-position-independent; chained/cascading
  *value* dependencies belong to dashboardkit.

## Conventions

- No unnecessary comments — only add when the WHY is non-obvious.
- Every exported public type/function goes through `src/index.ts`,
  `src/react/index.ts`, or an explicit `src/adapters/**/index.ts` package
  entry.
- Tests live next to sources as `*.test.ts`.
- Record non-trivial design decisions (e.g. JSON Schema validator choice,
  `${var}` interpolation rules for string[]) in `docs/` as you make them.
