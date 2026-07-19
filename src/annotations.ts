import type { Resource } from './types'

/**
 * Marks a node as human-edited (human-editing-and-persistence.md #3). A
 * regeneration loop that rewrites the whole document — not a targeted
 * patch — must not silently discard a locked node; see
 * `preserveLockedNodes`. This is the only locking primitive for now:
 * "preserve this node on full regeneration," not a patch/diff contract.
 */
export const LOCKED_ANNOTATION = 'resourcekit.dev/locked'

export function isLocked(resource: Resource): boolean {
  return resource.metadata?.annotations?.[LOCKED_ANNOTATION] === 'true'
}

/** Returns `resource` with the locked annotation set, alongside its existing metadata/annotations. */
export function markLocked(resource: Resource): Resource {
  return {
    ...resource,
    metadata: {
      ...resource.metadata,
      annotations: { ...resource.metadata?.annotations, [LOCKED_ANNOTATION]: 'true' },
    },
  }
}

function identity(resource: Resource): string | undefined {
  return resource.metadata?.name ? `${resource.apiVersion}\u0000${resource.kind}\u0000${resource.metadata.name}` : undefined
}

function collectIdentities(resource: Resource, counts: Map<string, number>, locked?: Map<string, Resource>): void {
  const key = identity(resource)
  if (key) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if (locked && isLocked(resource)) locked.set(key, resource)
  }
  for (const slot of resource.slots ?? []) {
    for (const child of slot.items) collectIdentities(child, counts, locked)
  }
}

function applyLocked(resource: Resource, locked: Map<string, Resource>, previousCounts: Map<string, number>, nextCounts: Map<string, number>): Resource {
  const key = identity(resource)
  if (key && previousCounts.get(key) === 1 && nextCounts.get(key) === 1 && locked.has(key)) return locked.get(key)!

  if (!resource.slots) return resource
  return {
    ...resource,
    slots: resource.slots.map((slot) => ({
      ...slot,
      items: slot.items.map((child) => applyLocked(child, locked, previousCounts, nextCounts)),
    })),
  }
}

/**
 * Preserves locked nodes from `previous` when accepting a fully regenerated
 * `next` document — the minimal "full re-generate, but keep what a human
 * locked" behavior (human-editing-and-persistence.md #3), with no patch
 * format required.
 *
 * Matching uses `apiVersion`/`kind`/`metadata.name`, and only unambiguous
 * identities that occur once in both documents are preserved. A locked node
 * with no name can't be reliably matched and is not preserved. A
 * locked node whose name no longer appears anywhere in `next` (the LLM
 * dropped that whole branch) is also not reinserted — there is no defined
 * position for it without a patch/insert contract, see item 5 (deferred).
 */
export function preserveLockedNodes(previous: Resource, next: Resource): Resource {
  const locked = new Map<string, Resource>()
  const previousCounts = new Map<string, number>()
  const nextCounts = new Map<string, number>()
  collectIdentities(previous, previousCounts, locked)
  if (locked.size === 0) return next
  collectIdentities(next, nextCounts)
  return applyLocked(next, locked, previousCounts, nextCounts)
}
