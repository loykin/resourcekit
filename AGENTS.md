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
`DataBinding` fetch or an `ObjectStateRef` pointer), and `scope` (only for a
`scopeProvider: true` kind — `{name, binding, policy?}`; the runtime
resolves `binding` and publishes it to descendants as `ctx.scopes[name]` /
`{"$scope": name}`). Never add a same-named placeholder property to a
kind's own `specSchema` for these — they live on the envelope, not in
`spec`. Everything else in `spec` is either kind-owned outright, or a
shared vocabulary type (`SubmitSpec`, `DataBinding`) that the kind itself
chooses where to place and read (e.g. most kinds' own `spec.data`,
`spec.submit`).

Beyond rendering, the runtime provides (all optional, additive to a bare
`Resource`): named scope providers (`scopeProvider: true` kinds, `DataScope`
built in) that let unrelated sibling kinds share one fetch, resolved through
a swappable `QueryCoordinator` boundary for caching/polling when a `policy`
is set; a thin `ScopeRegistry` (in-memory, per-`ResourceRenderer`, not
routed through the store) that lets a `refetchData`/`invalidateData`
`SubmitEffect` reach a named scope provider anywhere in the tree by name; a
common `RuntimeStore` (namespaced KV + watch plane underlying
variables/objectState/scope/execution — see `src/runtime/store.ts`) that
never assigns meaning to what's stored; a `submit`/mutation dispatch path;
and an opaque host-action boundary (`EventPolicy.kind: "action"` →
allowlist check → `ResourceRenderer.onAction`, never interpreted or
executed by ResourceKit itself). `src/connection/` (REST/DSN resolvers,
always bundled, no credential storage) is separate from `src/connectors/*`
(optional third-party integrations, e.g. TanStack Query, shipped as their
own subpath).

There is deliberately no document-level dependency graph or multi-hop
chaining (a `scopeProvider` kind's `binding` is a single fetch, not a node
referencing other nodes) — chained/cascading data dependencies belong to
dashboardkit, same boundary as the flat variable engine below.

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
  scoping, variable engine, object-state engine, `ScopeRegistry`,
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
  `ConnectionAdapter` bridging a registered connection to `@loykin/datasourcekit`.
- `src/connectors/tanstack-query/index.ts` (`./connectors/tanstack-query`) —
  optional `QueryCoordinator` backed by `@tanstack/query-core`. `connectors/*`
  are optional third-party integrations, distinct from `src/connection/`
  (always-bundled REST/DSN resolvers, no extra dependency) and from
  `src/adapters/*` (kind/UI adapters).

Current state: the core engine (registry, validation, scoped schema
generation, variable engine, object-state engine, resolvers) and the React
renderer are implemented and unit-tested. First-party kind adapters ship
from resourcekit adapter subpaths and are exercised by the playground and
MCP server example.

## Hard Rules

- Core must remain React-free. If a core feature seems to need React types,
  the design is wrong — stop and reconsider.
- The `datasource` resolver ships as a datasourcekit adapter package, never
  in core. Core knows only the `DataBinding` envelope and its `source`
  discriminator.
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
- `ScopeProviderNode` (`src/react/ResourceRenderer.tsx`) is the only
  coordinator-aware point — `ScopeRegistry` stays a plain function-call
  side-table (`register`/`refetch`/`invalidate` by name), never reaching
  into a coordinator itself or gaining graph/generation semantics.
- `RuntimeStore` (`src/runtime/store.ts`) is a common namespaced KV/watch
  plane. It stores snapshots and notifies subscribers and nothing else — it
  must never gain an adapter action registry, command semantics, or
  namespace-specific behavior. Each namespace's owner (variables,
  object-state, scope, submit, a plugin) decides what its own keys mean. A
  live callback (like `ScopeRegistry`'s refetch/invalidate) never goes
  through the store — that's command semantics, not a snapshot.
- `spec`'s `data`/`events`/`variables`-shaped placeholders must not be
  reintroduced. If a new runtime-owned, kind-independent concern comes up,
  it belongs on the `Resource` envelope (like
  `variables`/`events`/`objectState`/`record`/`scope`), not inside a kind's
  `specSchema` under a well-known name.
- A `scopeProvider` kind's `scope.binding` is a single fetch — it must never
  gain a way to reference another `scopeProvider`'s result (no document-level
  dependency graph, no multi-hop chaining). Sharing across sibling kinds
  works through the render tree (a scope provider as their common ancestor);
  chained/cascading dependencies belong to dashboardkit.

## Conventions

- No unnecessary comments — only add when the WHY is non-obvious.
- Every exported public type/function goes through `src/index.ts`,
  `src/react/index.ts`, or an explicit `src/adapters/**/index.ts` package
  entry.
- Tests live next to sources as `*.test.ts`.
- Record non-trivial design decisions (e.g. JSON Schema validator choice,
  `${var}` interpolation rules for string[]) in `docs/` as you make them.
