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

## Development

```bash
pnpm install
pnpm dev          # library watch + playground
pnpm test
pnpm build
```

## Status

Early development. The headless core (registry, validation, scoped schema
generation, variable engine, data resolvers) and the React renderer are
implemented; kind adapters for the Loykin kits are demonstrated in the
playground.

## License

MIT
