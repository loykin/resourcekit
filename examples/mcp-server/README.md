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
per-request, e.g. `rest` with a `${variable}` in the url pointed at a real
endpoint. The demo API's base URL (a random free port) is in the server's
`instructions`, along with the request shapes (`GET /users`,
`GET /users/:id`, `PATCH /users/:id`).

## Tools

- `list_root_templates` — get the candidate kinds for the document root
  (envelope-only, no spec).
- `next_stage_batch({ apiVersion, kind })` — resolve every slot of a node
  already in the document at once (`fixed` slots need no choice; `schema`
  covers the rest — its candidates are envelope-only too).
- `get_kind_spec_schema({ apiVersion, kind })` — get a specific kind's full
  spec JSON Schema, once you've picked it from a candidate list above.
- `validate_document({ resource })` — structurally validate a finished
  document against the scope.

The server's `instructions` field spells out the build → recurse → validate
loop for the client.

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
