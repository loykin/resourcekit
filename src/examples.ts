import type { KindExample, KindManifest, PatternExample } from './types'
import type { ResourceRegistry, ScopedRegistry } from './registry'

export interface KindExampleEntry {
  manifest: KindManifest
  index: number
  example: KindExample
}

/**
 * Enumerates every registered example (kind + pattern) exactly once — the
 * single source of truth `ScopedRegistry.selectExamples()` and
 * `validateAllExamples` both build on, so a third example category only
 * needs to be added here instead of drifting between two hand-rolled loops.
 * Deliberately does not validate or scope-filter — callers decide that.
 */
export function listExampleEntries(registry: ResourceRegistry | ScopedRegistry): {
  kindExamples: KindExampleEntry[]
  patternExamples: PatternExample[]
} {
  const kindExamples: KindExampleEntry[] = []
  for (const manifest of registry.listKinds()) {
    ;(manifest.examples ?? []).forEach((example, index) => kindExamples.push({ manifest, index, example }))
  }
  return { kindExamples, patternExamples: registry.listPatternExamples() }
}
