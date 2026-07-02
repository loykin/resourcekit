# @loykin/resourcekit

Declarative resource runtime for Loykin kits — an AI/MCP agent writes a JSON
resource document, the application renders it with its own design system.

```jsonc
{
  "apiVersion": "loykin.dev/v1alpha1",
  "kind": "DesignKitListDetail",
  "spec": { "variables": [{ "name": "customerId", "persist": "url" }] },
  "slots": [
    { "name": "list", "children": [
      { "apiVersion": "loykin.dev/v1alpha1", "kind": "GridKitTable",
        "spec": { "data": { "source": "datasource", "datasourceUid": "crm", "query": { "table": "customers" } } } }
    ]}
  ]
}
```

- **Headless core** (`@loykin/resourcekit`) — registry/plugin host, JSON Schema
  validation and scoped schema generation, variable engine, data/mutation
  binding dispatch. No React dependency.
- **React adapter** (`@loykin/resourcekit/react`) — recursive renderer with
  parent-owned slots and unknown-kind fallback.
- **Kinds are plugins** — designkit, gridkit, chartkit, and basekit contribute
  kind manifests; apps register only what they support, and the AI receives a
  scoped schema describing exactly that.

## Specification

The full spec lives at [docs/loykin-resource-runtime.md](docs/loykin-resource-runtime.md)
— resource envelope, ownership rules, slot model, data bindings, variables,
mutations, scoped capabilities, and the phased development plan.

## Development

```bash
pnpm install
pnpm dev          # library watch + playground
pnpm test
pnpm build
```

## Status

Early scaffold. Types, registry, and package wiring are in place; Phase 0
(core engine) is in progress — see the Development Plan section of the spec.

## License

MIT
