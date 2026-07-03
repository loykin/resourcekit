import { describe, expect, it } from 'vitest'
import { createRegistry, staticResolver } from '../../src'
import type { KindRenderFn } from '../../src/react'
import { createFirstPartyResourceAdapters } from '../../src/adapters'
import { buildGenerationPayload, evaluateScenarioResource } from './evaluation'
import { scenarioDefinitions } from './index'

function registry() {
  const registry = createRegistry<KindRenderFn>()
  registry.use({
    name: 'scenario-test-resolvers',
    dataResolvers: { static: staticResolver, datasource: async () => [] },
    mutationResolvers: { memory: async (_binding, payload) => payload },
  })
  registry.use(createFirstPartyResourceAdapters())
  return registry
}

describe('playground scenarios', () => {
  it.each(scenarioDefinitions)('$id builds a prompt payload with a scoped schema', (scenario) => {
    const payload = buildGenerationPayload(scenario, registry())
    expect(payload.prompt.length).toBeGreaterThan(20)
    expect(payload.seedData).toBeDefined()
    expect(payload.scopedSchema).toMatchObject({ $ref: '#/$defs/resource' })
    expect(payload.rubric.requiredKinds.length).toBeGreaterThan(0)
  })

  it.each(scenarioDefinitions)('$id expected resource passes baseline scenario evaluation', (scenario) => {
    const result = evaluateScenarioResource(scenario, scenario.expectedResource, registry())
    expect(result).toMatchObject({ valid: true, score: 100, issues: [] })
    expect(result.checks.every((check) => check.pass)).toBe(true)
  })

  it.each(scenarioDefinitions)('$id scope only includes registered kinds', (scenario) => {
    const scopedRegistry = registry()
    for (const kind of scenario.scope.kinds?.include ?? []) {
      expect(scopedRegistry.getKind('loykin.dev/v1alpha1', kind), `${scenario.id} includes unregistered kind ${kind}`).toBeDefined()
    }
  })
})
