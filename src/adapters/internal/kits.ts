import type { ResourceKitPlugin } from '../../types'
import type { KindRenderFn } from '../../react/types'
import { createBaseKitPlugin } from '../basekit/plugin'
import { createChartKitPlugin } from '../chartkit/plugin'
import { createDesignKitPlugin } from '../designkit/plugin'
import { createGridKitPlugin } from '../gridkit/plugin'
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
