# resourcekit — AI Agent Instructions

## Project Overview

- **Package**: `@loykin/resourcekit`
- **Purpose**: Declarative resource runtime for Loykin kits. An AI/MCP agent
  emits a JSON resource document; the application validates it and renders it
  with its own design system (designkit, gridkit, chartkit, basekit).
- **Monorepo**: root (library), `playground/` (Vite dev server)

## Design Rules

The runtime follows a Kubernetes-like resource model: `apiVersion`/`kind`
identify a node, `spec` belongs to the kind, `slots` are parent-owned
placement groups holding child resources. Ownership boundaries are strict —
the runtime owns kind lookup, recursion, slot rendering, fallback,
validation dispatch, variables, and binding dispatch; each kind owns its
spec schema, slot policy, and prop mapping. Leaf kinds never know which
parent slot they are in; parents never read child specs.

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
  scoping, variable engine, `rest`/`static` data resolvers.
- `src/react/index.ts` (`./react`) — the only place React types may appear.
  Recursive `ResourceRenderer`, `RenderContext`, unknown-kind fallback.
- `src/adapters/index.ts` (`./adapters`) — combined first-party kind adapters
  and resource-view kinds.
- `src/adapters/{designkit,gridkit,chartkit,basekit}/index.ts`
  (`./adapters/*`) — per-kit adapter entries so consumers install only the
  kit peers they use.

Current state: the core engine (registry, validation, scoped schema
generation, variable engine, resolvers) and the React renderer are
implemented and unit-tested. First-party kind adapters ship from resourcekit
adapter subpaths and are exercised by the playground and MCP server example.

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

## Conventions

- No unnecessary comments — only add when the WHY is non-obvious.
- Every exported public type/function goes through `src/index.ts`,
  `src/react/index.ts`, or an explicit `src/adapters/**/index.ts` package
  entry.
- Tests live next to sources as `*.test.ts`.
- Record non-trivial design decisions (e.g. JSON Schema validator choice,
  `${var}` interpolation rules for string[]) in `docs/` as you make them.
