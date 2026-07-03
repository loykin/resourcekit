import type { ResourceKitPlugin } from '../../types'
import type { KindRenderFn } from '../../react/types'

export function variableName(ref: string | undefined): string | undefined {
  return ref?.startsWith('variables.') ? ref.slice('variables.'.length) : undefined
}

export function withKindAliases(
  plugin: ResourceKitPlugin<KindRenderFn>,
  aliases: Array<[source: string, target: string]>,
): ResourceKitPlugin<KindRenderFn> {
  const kinds = [...(plugin.kinds ?? [])]
  for (const [source, target] of aliases) {
    const manifest = kinds.find((kind) => kind.kind === source)
    if (manifest && !kinds.some((kind) => kind.kind === target)) {
      kinds.push({ ...manifest, kind: target })
    }
  }
  return { ...plugin, kinds }
}
