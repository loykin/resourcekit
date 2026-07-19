import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry'
import { validateAllExamples } from './validation'
import type { KindManifest, PatternExample } from './types'

const panel: KindManifest = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'Panel',
  specSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title'],
    properties: { title: { type: 'string' } },
  },
  slotPolicy: { defaultSlot: { min: 0, accepts: ['Text'] } },
  examples: [
    { description: 'A minimal panel', resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel', spec: { title: 'Customers' } } },
    // Broken on purpose — used to prove validateAllExamples catches this.
    { description: 'Broken: missing required title', resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel', spec: {} } },
  ],
}

const text: KindManifest = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'Text',
  specSchema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
}

const masterDetail: PatternExample = {
  name: 'panel-with-text',
  description: 'A panel composed with a text child',
  resource: {
    apiVersion: 'resourcekit.dev/v1alpha1',
    kind: 'Panel',
    spec: { title: 'Customers' },
    slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', spec: { text: 'Hello' } }] }],
  },
}

function registry() {
  const registry = createRegistry()
  registry.use({ name: 'test', kinds: [panel, text], patternExamples: [masterDetail] })
  return registry
}

describe('ScopedRegistry.selectExamples', () => {
  it('returns only kind examples that pass validateResource', () => {
    const scoped = registry().scope({})
    const selected = scoped.selectExamples()

    expect(selected.kindExamples).toHaveLength(1)
    expect(selected.kindExamples[0].description).toBe('A minimal panel')
  })

  it('returns registered pattern examples that validate', () => {
    const scoped = registry().scope({})
    const selected = scoped.selectExamples()

    expect(selected.patternExamples.map((example) => example.name)).toEqual(['panel-with-text'])
  })

  it('excludes examples for kinds the scope does not allow', () => {
    const scoped = registry().scope({ kinds: { include: ['Text'] } })
    const selected = scoped.selectExamples()

    expect(selected.kindExamples).toHaveLength(0)
    // the pattern example roots at Panel, which this scope no longer allows
    expect(selected.patternExamples).toHaveLength(0)
  })
})

describe('validateAllExamples', () => {
  it('reports every registered example that fails validateResource', () => {
    const failures = validateAllExamples(registry())

    expect(failures).toHaveLength(1)
    expect(failures[0].source).toBe('kind:resourcekit.dev/v1alpha1/Panel#1')
    expect(failures[0].issues.length).toBeGreaterThan(0)
  })

  it('reports nothing when every example is valid', () => {
    const clean = createRegistry()
    clean.use({ name: 'test', kinds: [{ ...panel, examples: [panel.examples![0]] }, text], patternExamples: [masterDetail] })

    expect(validateAllExamples(clean)).toEqual([])
  })
})
