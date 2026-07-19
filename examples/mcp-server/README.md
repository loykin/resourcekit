# resourcekit MCP server example

A minimal MCP server that exposes resourcekit's staged-generation primitives
(`nextStage` / `nextStageBatch` / `singleKindSchema` / `validateResource`)
directly as tools, with no orchestration loop of its own — see
`docs/staged-generation-experiment.md` ("Final decision") for why.

The point of this example: the playground's "Step-by-step generation" demo
proves the tool-calling loop *can* work, but it only ever drives it with a
random auto-filler, never a real reasoning client. This server lets an
actual MCP client (Claude Code, Claude Desktop, etc.) build a document by
really calling the tools and deciding what goes where — the real test of
whether the schemas are generation-friendly.

It uses the exact same registry as the playground (same kind adapters, same
scope shape: `rootLevels: ['template']`), so whatever a client produces here
reflects the real schema, not a hand-rolled toy one.

`events`, `submit.mutation`, and `variables` fields — which a kind's own
`specSchema` can't type on its own, since they depend on runtime types
(`EventPolicy`, `MutationBinding`, `VariableDeclaration`) and, for mutations,
which resolvers this scope actually has — are rewritten into real refs the
same way `data` already was, instead of shipping as bare `{"type":"object"}`.

A tiny in-memory REST API (`src/demo-api.ts`) starts alongside the server so
a client can build a real selection-driven detail view: resourcekit's
`static` data source is fixed, inline rows with no filtering step, so it
can't follow a selection — that needs a source that can be parameterized
per-request. Rather than pointing a raw `rest` binding at the demo API's URL
directly, it's registered as a connection (uid `demo-users`, see test.md
§5-7) — the server exposes it through the connection tools below, and
resource documents reference it by uid, never the URL (`{"source":
"connection", "connection": "demo-users", "request": {"path": "/users"}}`).

A second connection, `demo-orders` (uid, type `sqlite`), runs against an
in-memory `node:sqlite` database (`src/demo-db.ts`, no extra dependency) via
a hand-written `sqliteConnectionAdapter` (`src/sqlite-connection-adapter.ts`)
— this is a worked example of writing your own `ConnectionAdapter` for
whatever backend you actually have. Table/column names go through an
allowlist + identifier regex (they can't be parameterized in SQL); only
`where` values are bound query parameters.

A third connection, `demo-metrics` (uid, type `datasourcekit`), goes through
`@loykin/resourcekit/adapters/datasourcekit`'s `createDatasourceKitConnectionAdapter`
against the real published `@loykin/datasourcekit` package (test.md §8.2,
§11 step 9) — `src/demo-datasourcekit.ts` implements the
`DatasourceManagerBackend` contract DatasourceKit expects any real backend
to expose (types/instances/query/healthCheck/validateQuery/listNamespaces/listFields),
backing a small in-memory host-metrics dataset. Unlike the REST and SQLite
adapters, this one ships from resourcekit itself (not hand-written here) —
`@loykin/datasourcekit` is an optional peer dependency, isolated to its own
`./adapters/datasourcekit` subpath so core stays dependency-free.

`demo-users-dynamic` (`src/connection-store.ts`) is the same backend as
`demo-users` again, but registered through `registry.setConnectionProvider`
instead of `registerConnection` — it stands in for a host that keeps its own
connections in a database and looks them up on demand rather than baking
them into server boot code (test.md §12). `list_connections`/`get_connection`
don't distinguish the two sources; the registry checks its static map first
and falls back to the provider.

`secure-reports` demonstrates the production credential boundary. The host
maps `RESOURCEKIT_SECURE_REPORTS_URL` and
`RESOURCEKIT_SECURE_REPORTS_TOKEN` into a server-owned connection config via
`src/secure-reports-connection.ts`; resourcekit core never reads environment
variables itself. The demo API URL/token are only development fallbacks.
Scoped connection catalogs expose the uid, schema, and capabilities but
never the config or bearer token. The accompanying E2E test sends a real
authenticated HTTP request and asserts that the scoped catalog remains
redacted.

## Tools

- `list_root_templates` — get the candidate kinds for the document root
  (envelope-only, no spec).
- `next_stage_batch({ apiVersion, kind })` — resolve every slot of a node
  already in the document at once (`fixed` slots need no choice; `schema`
  covers the rest — its candidates are envelope-only too).
- `get_kind_spec_schema({ apiVersion, kind })` — get a specific kind's full
  spec JSON Schema, once you've picked it from a candidate list above.
- `list_connections` / `get_connection({ uid })` — see what connections this
  scope exposes (uid, type, request schema, capabilities) — never base
  URLs or credentials.
- `test_connection({ uid })` — check a connection is reachable.
- `inspect_connection({ uid, path? })` — explore a connection's structure,
  where the adapter supports it.
- `validate_connection_request({ uid, request })` — check a candidate
  request against the connection's registered policy.
- `preview_connection({ uid, request })` — run a request through the same
  execution path rendering would, capped to a small row sample.
- `validate_document({ resource })` — structurally validate a finished
  document against the scope.

The server's `instructions` field spells out the build → recurse → validate
loop for the client, plus the connection-exploration flow (test.md §7:
list → test → inspect → validate → preview → build → validate).

## Run it

```bash
pnpm install        # from the repo root, once
pnpm build           # from the repo root — this example imports the built dist/
```

Then point an MCP client at `src/server.ts` via `tsx`. For Claude Code:

```bash
claude mcp add resourcekit-example -- npx tsx /absolute/path/to/resourcekit/examples/mcp-server/src/server.ts
```

Or run it standalone (mostly useful to confirm it starts without crashing —
without a client attached it just sits listening on stdio):

```bash
pnpm start
```
