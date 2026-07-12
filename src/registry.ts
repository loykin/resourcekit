import type {
  JsonSchema,
  DataResolver,
  KindManifest,
  MutationResolver,
  ResourceKitPlugin,
  ScopeOptions,
} from './types'

/**
 * Plugin host. Registration is runtime data, not build-time wiring: plugins
 * may register at any time, and documents referencing an unregistered kind
 * degrade to the unknown-kind fallback until it arrives.
 */
export interface ResourceRegistry<TRender = unknown> {
  use(plugin: ResourceKitPlugin<TRender>): void
  getKind(apiVersion: string, kind: string): KindManifest<unknown, TRender> | undefined
  listKinds(): KindManifest<unknown, TRender>[]
  getDataResolver(source: string): DataResolver | undefined
  listDataResolvers(): string[]
  getMutationResolver(target: string): MutationResolver | undefined
  listMutationResolvers(): string[]
  /** Derive a restricted registry view for schema generation / MCP exposure. */
  scope(options: ScopeOptions): ScopedRegistry<TRender>
  /** Subscribe to registration changes (drives re-render of fallback nodes). */
  subscribe(listener: () => void): () => void
}

export interface ScopedRegistry<TRender = unknown> extends Omit<ResourceRegistry<TRender>, 'use' | 'scope'> {
  readonly options: ScopeOptions
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
  const apiVersionAllowed = !options.apiVersions || options.apiVersions.includes(manifest.apiVersion)
  const included = !options.kinds?.include || options.kinds.include.includes(manifest.kind)
  const excluded = options.kinds?.exclude?.includes(manifest.kind) ?? false
  return apiVersionAllowed && included && !excluded
}

export function createRegistry<TRender = unknown>(): ResourceRegistry<TRender> {
  const kinds = new Map<string, KindManifest<unknown, TRender>>()
  const dataResolvers = new Map<string, DataResolver>()
  const mutationResolvers = new Map<string, MutationResolver>()
  const listeners = new Set<() => void>()

  const notify = () => listeners.forEach((l) => l())

  return {
    use(plugin) {
      for (const manifest of plugin.kinds ?? []) {
        kinds.set(kindKey(manifest.apiVersion, manifest.kind), manifest)
      }
      for (const [source, resolver] of Object.entries(plugin.dataResolvers ?? {})) {
        dataResolvers.set(source, resolver)
      }
      for (const [target, resolver] of Object.entries(plugin.mutationResolvers ?? {})) {
        mutationResolvers.set(target, resolver)
      }
      notify()
    },
    getKind: (apiVersion, kind) => kinds.get(kindKey(apiVersion, kind)),
    listKinds: () => [...kinds.values()],
    getDataResolver: (source) => dataResolvers.get(source),
    listDataResolvers: () => [...dataResolvers.keys()],
    getMutationResolver: (target) => mutationResolvers.get(target),
    listMutationResolvers: () => [...mutationResolvers.keys()],
    scope(options): ScopedRegistry<TRender> {
      const scoped: ScopedRegistry<TRender> = {
        options,
        getKind(apiVersion, kind) {
          const manifest = kinds.get(kindKey(apiVersion, kind))
          if (!manifest || !kindAllowed(manifest, options)) return undefined
          return applySlotScope(manifest, options)
        },
        listKinds() {
          return [...kinds.values()]
            .filter((manifest) => kindAllowed(manifest, options))
            .map((manifest) => applySlotScope(manifest, options))
        },
        getDataResolver(source) {
          return dataResolvers.get(source)
        },
        listDataResolvers() {
          return [...dataResolvers.keys()]
        },
        getMutationResolver(target) {
          return mutationResolvers.get(target)
        },
        listMutationResolvers() {
          return [...mutationResolvers.keys()]
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
