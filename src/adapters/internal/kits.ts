import type { KindManifest, ResourceKitPlugin } from '../../core/types'
import type { KindRenderFn } from '../../react'
import { createBaseKitPlugin } from '../basekit'
import { createChartKitPlugin } from '../chartkit'
import { createDesignKitPlugin } from '../designkit'
import { createGridKitPlugin } from '../gridkit'
import { createResourceViewPlugin } from '../views/plugin'

export { createBaseKitPlugin } from '../basekit/plugin'
export { createChartKitPlugin } from '../chartkit/plugin'
export { createDesignKitPlugin } from '../designkit/plugin'
export { createGridKitPlugin } from '../gridkit/plugin'
export { createResourceViewPlugin } from '../views/plugin'

export function composeResourceKitPlugins(name: string, plugins: Array<ResourceKitPlugin<KindRenderFn>>): ResourceKitPlugin<KindRenderFn> {
  return {
    name,
    kinds: plugins.flatMap((plugin) => plugin.kinds ?? []),
    dataResolvers: Object.assign({}, ...plugins.map((plugin) => plugin.dataResolvers ?? {})),
    mutationResolvers: Object.assign({}, ...plugins.map((plugin) => plugin.mutationResolvers ?? {})),
  }
}

export function createFirstPartyResourceAdapters(): ResourceKitPlugin<KindRenderFn> {
  return composeResourceKitPlugins('first-party-adapters', [
    createDesignKitPlugin(),
    createGridKitPlugin(),
    createChartKitPlugin(),
    createBaseKitPlugin(),
    createResourceViewPlugin(),
  ])
}

export function createPlaygroundResourceAdapters(): ResourceKitPlugin<KindRenderFn> {
  return createFirstPartyResourceAdapters()
}

const INTERNAL_KIND_NAME = /^(DesignKit|GridKit|ChartKit|BaseKit)[A-Z]/

/**
 * Kind names meant for documents to actually use. Excludes the internal
 * `DesignKit`/`GridKit`/`ChartKit`/`BaseKit`-prefixed manifests that
 * `withKindAliases` (see internal/shared.ts) renames from — every one of
 * them has a short public alias covering it (e.g. `DesignKitPanel` ->
 * `Panel`), so listing both in a scope's `kinds.include` just duplicates
 * every candidate a generated schema offers.
 */
export function publicKindNames(registry: { listKinds(): Pick<KindManifest, 'kind'>[] }): string[] {
  return registry
    .listKinds()
    .map((manifest) => manifest.kind)
    .filter((kind) => !INTERNAL_KIND_NAME.test(kind))
}
