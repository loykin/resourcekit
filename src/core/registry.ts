import type {
  JsonSchema,
  ConnectionManifest,
  ConnectionProvider,
  ConnectionSummary,
  DataSourceManifest,
  KindManifest,
  MutationSourceManifest,
  PatternExample,
  RegisteredConnection,
  ResourceKitPlugin,
  ScopeOptions,
  SelectedExamples,
} from './types'
import { validateResource } from './validation'
import { listExampleEntries } from './examples'
import { allowListFilter, createNamedRegistry, scopedView } from './namedRegistry'

/**
 * Plugin host. Registration is runtime data, not build-time wiring: plugins
 * may register at any time, and documents referencing an unregistered kind
 * degrade to the unknown-kind fallback until it arrives.
 */
export interface ResourceRegistry<TRender = unknown> {
  use(plugin: ResourceKitPlugin<TRender>): void
  getKind(apiVersion: string, kind: string): KindManifest<unknown, TRender> | undefined
  listKinds(): KindManifest<unknown, TRender>[]
  /** Registered multi-kind pattern examples, unfiltered — see `ScopedRegistry.selectExamples` for the scope-validated view. */
  listPatternExamples(): PatternExample[]
  getDataSourceManifest(apiVersion: string, kind: string): DataSourceManifest | undefined
  listDataSourceManifests(): DataSourceManifest[]
  getMutationSourceManifest(apiVersion: string, kind: string): MutationSourceManifest | undefined
  listMutationSourceManifests(): MutationSourceManifest[]
  /** Connection kinds (rest, datasourcekit, ...), registered via `use()`. */
  getConnectionManifest(apiVersion: string, kind: string): ConnectionManifest | undefined
  listConnectionManifests(): ConnectionManifest[]
  /** Registers/updates one connection instance in place — no snapshot rebuild needed for hosts managing connections dynamically (test.md §5.2). */
  registerConnection(connection: RegisteredConnection): void
  unregisterConnection(uid: string): void
  /** Registers a dynamic connection source (test.md §12) — consulted after the static map on lookup/list. Pass `undefined` to clear. */
  setConnectionProvider(provider: ConnectionProvider | undefined): void
  getConnection(uid: string): Promise<RegisteredConnection | undefined>
  listConnections(): Promise<RegisteredConnection[]>
  /** Derive a restricted registry view for schema generation / MCP exposure. */
  scope(options: ScopeOptions): ScopedRegistry<TRender>
  /** Subscribe to registration changes (drives re-render of fallback nodes). */
  subscribe(listener: () => void): () => void
}

export interface ScopedRegistry<TRender = unknown>
  extends Omit<
    ResourceRegistry<TRender>,
    'use' | 'scope' | 'registerConnection' | 'unregisterConnection' | 'setConnectionProvider' | 'listConnections'
  > {
  readonly options: ScopeOptions
  /** MCP-facing connection view — `config` (base URL, DSN, credentials) stripped, capabilities intersected from adapter ∩ connection.mcpPolicy ∩ scope (test.md §5.3, §6). */
  listConnections(): Promise<ConnectionSummary[]>
  /** Kind + pattern examples that are both scope-allowed and independently pass `validateResource` against this scope (generation-quality.md) — never include an example a document couldn't actually reuse as-is. */
  selectExamples(): SelectedExamples
}

function kindKey(apiVersion: string, kind: string): string {
  return `${apiVersion}/${kind}`
}

function cloneSchema(schema: JsonSchema): JsonSchema {
  return structuredClone(schema)
}

function getObjectProperties(schema: JsonSchema): Record<string, unknown> | undefined {
  return typeof schema.properties === 'object' && schema.properties !== null && !Array.isArray(schema.properties)
    ? (schema.properties as Record<string, unknown>)
    : undefined
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function applySpecScope(schema: JsonSchema, kind: string, options: ScopeOptions): JsonSchema {
  const specOptions = options.spec?.[kind]
  if (!specOptions) return cloneSchema(schema)

  const scoped = cloneSchema(schema)
  const properties = getObjectProperties(scoped)
  if (!properties) return scoped

  if (specOptions.pick) {
    for (const key of Object.keys(properties)) {
      if (!specOptions.pick.includes(key)) delete properties[key]
    }
  }

  for (const key of specOptions.omit ?? []) {
    delete properties[key]
  }

  // pick/omit narrow the *allowed* field set. If the underlying spec schema
  // left additionalProperties open (or unset — JSON Schema treats that as
  // open too), a removed field would still validate: the scope would only be
  // hiding the field from the generated schema, not actually rejecting it.
  // Close it so pick/omit are a real capability boundary, not a UI hint.
  if (specOptions.pick || (specOptions.omit && specOptions.omit.length > 0)) {
    scoped.additionalProperties = false
  }

  const required = Array.isArray(scoped.required)
    ? scoped.required.filter((value): value is string => typeof value === 'string')
    : []

  for (const [key, value] of Object.entries(specOptions.lock ?? {})) {
    properties[key] = { const: value }
    required.push(key)
  }

  if (required.length > 0) {
    scoped.required = unique(required.filter((key) => key in properties))
  }

  return scoped
}

function applySlotScope<T>(manifest: KindManifest<unknown, T>, options: ScopeOptions): KindManifest<unknown, T> {
  const slotOptions = options.slots?.[manifest.kind]
  const specSchema = applySpecScope(manifest.specSchema, manifest.kind, options)
  if (!slotOptions || !manifest.slotPolicy) {
    return { ...manifest, specSchema }
  }

  const slotPolicy = structuredClone(manifest.slotPolicy)
  if (slotPolicy.slots) {
    for (const name of Object.keys(slotPolicy.slots)) {
      const included = !slotOptions.include || slotOptions.include.includes(name)
      const excluded = slotOptions.exclude?.includes(name) ?? false
      if (!included || excluded) delete slotPolicy.slots[name]
    }
  }

  return { ...manifest, specSchema, slotPolicy }
}

function kindAllowed(manifest: KindManifest, options: ScopeOptions): boolean {
  // hostAuthoredOnly is not overridable by kinds.include — a scope author
  // naming the kind explicitly is exactly the mistake this flag exists to
  // prevent (provisr-poc-findings.md #9).
  if (manifest.hostAuthoredOnly) return false
  const apiVersionAllowed = !options.apiVersions || options.apiVersions.includes(manifest.apiVersion)
  const included = !options.kinds?.include || options.kinds.include.includes(manifest.kind)
  const excluded = options.kinds?.exclude?.includes(manifest.kind) ?? false
  return apiVersionAllowed && included && !excluded
}

function connectionAllowed(uid: string, options: ScopeOptions): boolean {
  return !options.connections?.allow || options.connections.allow.includes(uid)
}

const CONNECTION_READ_CAPABILITIES = ['test', 'inspect', 'preview'] as const

function toConnectionSummary(
  connection: RegisteredConnection,
  manifest: ConnectionManifest | undefined,
  options: ScopeOptions,
): ConnectionSummary | undefined {
  if (!manifest) return undefined
  const scopeCapabilities = options.connections?.capabilities

  const capabilities = { test: false, inspect: false, preview: false, mutate: false }
  for (const name of CONNECTION_READ_CAPABILITIES) {
    const manifestHas = typeof manifest[name] === 'function'
    const mcpAllowed = connection.mcpPolicy?.[name] ?? true
    const scopeAllowed = scopeCapabilities?.[name] ?? true
    capabilities[name] = manifestHas && mcpAllowed && scopeAllowed
  }
  capabilities.mutate = (connection.mcpPolicy?.mutate ?? false) && (scopeCapabilities?.mutate ?? false)

  return {
    uid: connection.uid,
    apiVersion: connection.apiVersion,
    kind: connection.kind,
    name: connection.name,
    description: connection.description,
    requestSchema: manifest.requestSchema,
    ...(manifest.resultSchema ? { resultSchema: manifest.resultSchema } : {}),
    capabilities,
  }
}

export function createRegistry<TRender = unknown>(): ResourceRegistry<TRender> {
  const kinds = createNamedRegistry<KindManifest<unknown, TRender>>()
  const patternExamples = createNamedRegistry<PatternExample>()
  const dataSourceManifests = createNamedRegistry<DataSourceManifest>()
  const mutationSourceManifests = createNamedRegistry<MutationSourceManifest>()
  const connectionManifests = createNamedRegistry<ConnectionManifest>()
  const connections = createNamedRegistry<RegisteredConnection>()
  let connectionProvider: ConnectionProvider | undefined
  const listeners = new Set<() => void>()

  const notify = () => listeners.forEach((l) => l())

  async function resolveConnection(uid: string): Promise<RegisteredConnection | undefined> {
    const stored = connections.get(uid)
    if (stored) return stored
    const provided = await connectionProvider?.getConnection(uid)
    // A provider returning a connection whose own `uid` doesn't match the
    // uid it was looked up by would let a caller who only checked the
    // requested uid against an allowlist (e.g. scope's connectionAllowed)
    // receive a different, possibly disallowed connection's config/adapter.
    return provided && provided.uid === uid ? provided : undefined
  }

  async function resolveAllConnections(): Promise<RegisteredConnection[]> {
    const merged = new Map<string, RegisteredConnection>()
    for (const connection of (await connectionProvider?.listConnections()) ?? []) {
      merged.set(connection.uid, connection)
    }
    // Static registrations win on uid collision with the provider.
    for (const connection of connections.list()) {
      merged.set(connection.uid, connection)
    }
    return [...merged.values()]
  }

  return {
    use(plugin) {
      for (const manifest of plugin.kinds ?? []) {
        kinds.register(kindKey(manifest.apiVersion, manifest.kind), manifest)
      }
      for (const example of plugin.patternExamples ?? []) {
        patternExamples.register(example.name, example)
      }
      for (const manifest of plugin.dataSourceManifests ?? []) {
        dataSourceManifests.register(kindKey(manifest.apiVersion, manifest.kind), manifest)
      }
      for (const manifest of plugin.mutationSourceManifests ?? []) {
        mutationSourceManifests.register(kindKey(manifest.apiVersion, manifest.kind), manifest)
      }
      for (const manifest of plugin.connectionManifests ?? []) {
        connectionManifests.register(kindKey(manifest.apiVersion, manifest.kind), manifest)
      }
      notify()
    },
    getKind: (apiVersion, kind) => kinds.get(kindKey(apiVersion, kind)),
    listKinds: () => kinds.list(),
    listPatternExamples: () => patternExamples.list(),
    getDataSourceManifest: (apiVersion, kind) => dataSourceManifests.get(kindKey(apiVersion, kind)),
    listDataSourceManifests: () => dataSourceManifests.list(),
    getMutationSourceManifest: (apiVersion, kind) => mutationSourceManifests.get(kindKey(apiVersion, kind)),
    listMutationSourceManifests: () => mutationSourceManifests.list(),
    getConnectionManifest: (apiVersion, kind) => connectionManifests.get(kindKey(apiVersion, kind)),
    listConnectionManifests: () => connectionManifests.list(),
    registerConnection(connection) {
      connections.register(connection.uid, connection)
      notify()
    },
    unregisterConnection(uid) {
      connections.remove(uid)
      notify()
    },
    setConnectionProvider(provider) {
      connectionProvider = provider
      notify()
    },
    getConnection: resolveConnection,
    listConnections: resolveAllConnections,
    scope(options): ScopedRegistry<TRender> {
      const kindsView = scopedView(kinds, options, {
        allowed: (_key, manifest) => kindAllowed(manifest, options),
        transform: applySlotScope,
      })
      const dataSourceManifestsView = scopedView(dataSourceManifests, options, {
        allowed: (_key, manifest) => allowListFilter(manifest.kind, options.dataSourceManifests),
      })
      const mutationSourceManifestsView = scopedView(mutationSourceManifests, options, {
        allowed: (_key, manifest) => allowListFilter(manifest.kind, options.mutationSourceManifests),
      })
      const connectionManifestsView = scopedView(connectionManifests, options, {
        allowed: (_key, manifest) => allowListFilter(manifest.kind, options.connectionManifests),
      })

      const scoped: ScopedRegistry<TRender> = {
        options,
        getKind: (apiVersion, kind) => kindsView.get(kindKey(apiVersion, kind)),
        listKinds: kindsView.list,
        // Deliberately unfiltered here — real filtering happens per-example
        // in selectExamples() below via validateResource, not an allow list.
        listPatternExamples() {
          return patternExamples.list()
        },
        selectExamples() {
          const entries = listExampleEntries(scoped)
          const kindExamples: SelectedExamples['kindExamples'] = []
          for (const { manifest, example } of entries.kindExamples) {
            if (!kindAllowed(manifest, options)) continue
            if (validateResource(example.resource, scoped).valid) {
              kindExamples.push({ apiVersion: manifest.apiVersion, kind: manifest.kind, description: example.description, resource: example.resource })
            }
          }
          const filteredPatternExamples = entries.patternExamples.filter((example) => validateResource(example.resource, scoped).valid)
          return { kindExamples, patternExamples: filteredPatternExamples }
        },
        getDataSourceManifest: (apiVersion, kind) => dataSourceManifestsView.get(kindKey(apiVersion, kind)),
        listDataSourceManifests: dataSourceManifestsView.list,
        getMutationSourceManifest: (apiVersion, kind) => mutationSourceManifestsView.get(kindKey(apiVersion, kind)),
        listMutationSourceManifests: mutationSourceManifestsView.list,
        getConnectionManifest: (apiVersion, kind) => connectionManifestsView.get(kindKey(apiVersion, kind)),
        listConnectionManifests: connectionManifestsView.list,
        async getConnection(uid) {
          if (!connectionAllowed(uid, options)) return undefined
          return resolveConnection(uid)
        },
        async listConnections() {
          const all = await resolveAllConnections()
          return all
            .filter((connection) => connectionAllowed(connection.uid, options))
            .map((connection) => toConnectionSummary(connection, connectionManifests.get(kindKey(connection.apiVersion, connection.kind)), options))
            .filter((summary): summary is ConnectionSummary => summary !== undefined)
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
      return scoped
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
