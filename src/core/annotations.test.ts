import { describe, expect, it } from 'vitest'
import { LOCKED_ANNOTATION, isLocked, markLocked, preserveLockedNodes } from './annotations'
import type { Resource } from './types'

function node(overrides: Partial<Resource> = {}): Resource {
  return { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel', spec: {}, ...overrides }
}

describe('markLocked / isLocked', () => {
  it('marks a resource locked without disturbing existing metadata', () => {
    const resource = node({ metadata: { name: 'summary', labels: { team: 'ops' } } })
    const locked = markLocked(resource)

    expect(isLocked(locked)).toBe(true)
    expect(locked.metadata).toEqual({ name: 'summary', labels: { team: 'ops' }, annotations: { [LOCKED_ANNOTATION]: 'true' } })
    expect(isLocked(resource)).toBe(false)
  })

  it('treats a resource with no annotations as unlocked', () => {
    expect(isLocked(node())).toBe(false)
  })
})

describe('preserveLockedNodes', () => {
  it('replaces a regenerated node with its locked previous version, matched by name', () => {
    const previous: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Workbench',
      spec: {},
      slots: [
        {
          items: [
            markLocked(node({ metadata: { name: 'summary' }, spec: { title: 'Hand-tuned title' } })),
            node({ metadata: { name: 'chart' }, spec: { title: 'Old chart title' } }),
          ],
        },
      ],
    }
    const next: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Workbench',
      spec: {},
      slots: [
        {
          items: [
            node({ metadata: { name: 'summary' }, spec: { title: 'Regenerated title' } }),
            node({ metadata: { name: 'chart' }, spec: { title: 'Regenerated chart title' } }),
          ],
        },
      ],
    }

    const result = preserveLockedNodes(previous, next)

    expect(result.slots?.[0].items[0].spec).toEqual({ title: 'Hand-tuned title' })
    expect(isLocked(result.slots?.[0].items[0] as Resource)).toBe(true)
    // unlocked sibling is taken from the regenerated document, not preserved
    expect(result.slots?.[0].items[1].spec).toEqual({ title: 'Regenerated chart title' })
  })

  it('is a no-op when nothing in previous is locked', () => {
    const previous = node({ metadata: { name: 'summary' }, spec: { title: 'Old' } })
    const next = node({ metadata: { name: 'summary' }, spec: { title: 'New' } })

    expect(preserveLockedNodes(previous, next)).toBe(next)
  })

  it('does not preserve a locked node that has no name — matching requires one', () => {
    const previous: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Workbench',
      spec: {},
      slots: [{ items: [markLocked(node({ spec: { title: 'Hand-tuned' } }))] }],
    }
    const next: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Workbench',
      spec: {},
      slots: [{ items: [node({ spec: { title: 'Regenerated' } })] }],
    }

    const result = preserveLockedNodes(previous, next)
    expect(result.slots?.[0].items[0].spec).toEqual({ title: 'Regenerated' })
  })

  it('does not reinsert a locked node whose name the regenerated tree dropped entirely', () => {
    const previous: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Workbench',
      spec: {},
      slots: [{ items: [markLocked(node({ metadata: { name: 'summary' } })), node({ metadata: { name: 'chart' } })] }],
    }
    const next: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Workbench',
      spec: {},
      slots: [{ items: [node({ metadata: { name: 'chart' } })] }],
    }

    const result = preserveLockedNodes(previous, next)
    expect(result.slots?.[0].items).toHaveLength(1)
    expect(result.slots?.[0].items[0].metadata?.name).toBe('chart')
  })

  it('does not apply an ambiguous lock when the same kind and name occurs more than once', () => {
    const previous: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Workbench',
      spec: {},
      slots: [
        {
          items: [
            markLocked(node({ metadata: { name: 'summary' }, spec: { title: 'Locked' } })),
            node({ metadata: { name: 'summary' }, spec: { title: 'Other branch' } }),
          ],
        },
      ],
    }
    const next: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Workbench',
      spec: {},
      slots: [
        {
          items: [
            node({ metadata: { name: 'summary' }, spec: { title: 'Generated A' } }),
            node({ metadata: { name: 'summary' }, spec: { title: 'Generated B' } }),
          ],
        },
      ],
    }

    expect(preserveLockedNodes(previous, next).slots?.[0].items.map((item) => item.spec)).toEqual([
      { title: 'Generated A' },
      { title: 'Generated B' },
    ])
  })

  it('keeps same-name resources of different kinds distinct', () => {
    const previous: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Workbench',
      spec: {},
      slots: [
        {
          items: [
            markLocked(node({ metadata: { name: 'summary' }, spec: { title: 'Locked panel' } })),
            node({ kind: 'Text', metadata: { name: 'summary' }, spec: { text: 'Old text' } }),
          ],
        },
      ],
    }
    const next: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Workbench',
      spec: {},
      slots: [
        {
          items: [
            node({ metadata: { name: 'summary' }, spec: { title: 'Generated panel' } }),
            node({ kind: 'Text', metadata: { name: 'summary' }, spec: { text: 'Generated text' } }),
          ],
        },
      ],
    }

    const result = preserveLockedNodes(previous, next)
    expect(result.slots?.[0].items[0].spec).toEqual({ title: 'Locked panel' })
    expect(result.slots?.[0].items[1].spec).toEqual({ text: 'Generated text' })
  })
})
