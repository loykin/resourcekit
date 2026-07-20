// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Resource, ResourceDocument } from '@loykin/resourcekit'

let app: typeof import('./App')

beforeAll(async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  app = await import('./App')
})

function rootResource(value: Resource | ResourceDocument): Resource {
  return 'resource' in value ? value.resource : value
}

function kindsIn(resource: Resource): string[] {
  return [resource.kind, ...(resource.slots ?? []).flatMap((slot) => slot.items.flatMap(kindsIn))]
}

describe('playground example catalog', () => {
  it('classifies every demo without exposing internal legacy kind names', () => {
    expect(app.examples).toHaveLength(23)
    expect(app.examples.filter((example) => example.category === 'scenario')).toHaveLength(3)
    expect(app.examples.filter((example) => example.category === 'mcp-generated')).toHaveLength(3)
    expect(app.examples.filter((example) => example.category === 'designkit-parity')).toHaveLength(3)
    expect(app.examples.filter((example) => example.category === 'fragment').map((example) => example.id)).toEqual([
      'coin-market-cap-top10',
      'metrics-chart',
      'from-value-binding',
    ])

    const internalKind = /^(DesignKit|GridKit|ChartKit|BaseKit)[A-Z]/
    for (const example of app.examples) {
      expect(kindsIn(rootResource(example.resource)).filter((kind) => internalKind.test(kind)), example.id).toEqual([])
    }
  })

  it('uses one scope for root selection, every slot choice, and final validation', () => {
    for (const example of app.examples) {
      const inspection = app.inspectPlaygroundExample(example)
      expect(inspection.root.ok, `${example.id}: root ${inspection.rootResource.kind}`).toBe(true)
      expect(inspection.checks.filter((check) => !check.ok), example.id).toEqual([])
      expect(inspection.validation, example.id).toEqual({ valid: true, issues: [] })

      if (example.category === 'fragment') {
        expect(inspection.scope.options.rootLevels, example.id).toBeUndefined()
      } else {
        expect(inspection.scope.options.rootLevels, example.id).toEqual(['template'])
      }
    }
  })

  it('keeps generation evidence distinct from hand-authored runtime demos', () => {
    for (const example of app.examples) {
      if (example.category === 'scenario' || example.category === 'mcp-generated') {
        expect(example.evidence, example.id).toBeTruthy()
      } else {
        expect(example.evidence, example.id).toBeUndefined()
      }
    }
  })
})
