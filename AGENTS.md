# resourcekit — AI Agent Instructions

## Project Overview

- **Package**: `@loykin/resourcekit`
- **Purpose**: Declarative resource runtime for Loykin kits. An AI/MCP agent
  emits a JSON resource document; the application validates it and renders it
  with its own design system (designkit, gridkit, chartkit, basekit).
- **Monorepo**: root (library), `playground/` (Vite dev server)

## Single Source of Truth

`docs/loykin-resource-runtime.md` is the specification. Read it before
changing anything. It defines the resource envelope, ownership rules, slot
model, data/mutation bindings, the variable engine, scoped capabilities,
validation layers, the plugin model, and the phased Development Plan with
exit criteria. When code and spec disagree, fix one of them explicitly —
never let them drift silently.

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

Two package entries:

- `src/index.ts` (`.`) — **headless core**. No React imports anywhere under
  this entry. Types, registry/plugin host, validation, schema generation +
  scoping, variable engine, `rest`/`static` data resolvers.
- `src/react/index.ts` (`./react`) — the only place React types may appear.
  Recursive `ResourceRenderer`, `RenderContext`, unknown-kind fallback.

Current state: types and registry are implemented; functions marked
`TODO(phase-N)` throw `not implemented`. Work through the Development Plan
phases in order — Phase 0 (core engine, pure unit tests) is next.

## Hard Rules

- Core must remain React-free. If a core feature seems to need React types,
  the design is wrong — stop and reconsider.
- The `datasource` resolver ships as a datasourcekit adapter package, never
  in core. Core knows only the `DataBinding` envelope and its `source`
  discriminator.
- Kind adapters map resource specs onto existing kit public props. Existing
  kit APIs (designkit, gridkit, chartkit, basekit) must not change.
- The variable engine stays flat (see "Scope boundary with dashboardkit" in
  the spec). Chained variables, options queries, and dependency DAGs belong
  to dashboardkit — if you find yourself adding them here, stop.
- MCP/AI must only ever receive a scoped schema (`registry.scope(...)`),
  never the full registry schema.
- Unknown or not-yet-loaded kinds degrade that node to a fallback; they must
  never fail the whole document.
- Phase 0 code must be testable without a DOM (vitest, node environment).

## Conventions

- No unnecessary comments — only add when the WHY is non-obvious.
- Every exported public type/function goes through `src/index.ts` or
  `src/react/index.ts`.
- Tests live next to sources as `*.test.ts`.
- Record non-trivial design decisions (e.g. JSON Schema validator choice,
  `${var}` interpolation rules for string[]) in `docs/` as you make them.
