import { buildDocumentSchema, scanVariableRefs, validateResource } from '../../src'
import type { JsonSchema, LoykinResource, ResourceRegistry, ScopeOptions, ValidationIssue } from '../../src'
import type { KindRenderFn } from '../../src/react'

export interface ScenarioDefinition<TSeed = unknown> {
  id: string
  prompt: string
  scope: ScopeOptions
  seedData: TSeed
  expectedResource: LoykinResource
  rubric: ScenarioRubric
}

export interface ScenarioRubric {
  requiredKinds: string[]
  requiredVariables?: string[]
  requiredEvents?: string[]
  requiredBindings?: Array<{ source: string; datasourceUid?: string }>
  requiredText?: string[]
  forbiddenKindPrefixes?: string[]
}

export interface GenerationPayload<TSeed = unknown> {
  scenarioId: string
  prompt: string
  seedData: TSeed
  scopedSchema: JsonSchema
  rubric: ScenarioRubric
}

export interface ScenarioEvaluation {
  valid: boolean
  score: number
  issues: ValidationIssue[]
  checks: Array<{ name: string; pass: boolean; message?: string }>
}

export function buildGenerationPayload<TSeed>(
  scenario: ScenarioDefinition<TSeed>,
  registry: ResourceRegistry<KindRenderFn>,
): GenerationPayload<TSeed> {
  return {
    scenarioId: scenario.id,
    prompt: scenario.prompt,
    seedData: scenario.seedData,
    scopedSchema: buildDocumentSchema(registry.scope(scenario.scope)),
    rubric: scenario.rubric,
  }
}

export function evaluateScenarioResource<TSeed>(
  scenario: ScenarioDefinition<TSeed>,
  candidate: LoykinResource,
  registry: ResourceRegistry<KindRenderFn>,
): ScenarioEvaluation {
  const scoped = registry.scope(scenario.scope)
  const validation = validateResource(candidate, scoped)
  const checks = [
    ...scenario.rubric.requiredKinds.map((kind) => ({
      name: `kind:${kind}`,
      pass: collectKinds(candidate).includes(kind),
      message: `expected resource tree to include kind ${kind}`,
    })),
    ...(scenario.rubric.requiredVariables ?? []).map((variable) => ({
      name: `variable:${variable}`,
      pass: collectVariables(candidate).includes(variable),
      message: `expected resource tree to declare or reference variable ${variable}`,
    })),
    ...(scenario.rubric.requiredEvents ?? []).map((event) => ({
      name: `event:${event}`,
      pass: collectEventNames(candidate).includes(event),
      message: `expected resource tree to include event ${event}`,
    })),
    ...(scenario.rubric.requiredBindings ?? []).map((binding) => ({
      name: binding.datasourceUid ? `binding:${binding.source}:${binding.datasourceUid}` : `binding:${binding.source}`,
      pass: collectBindings(candidate).some(
        (candidateBinding) =>
          candidateBinding.source === binding.source &&
          (binding.datasourceUid === undefined || candidateBinding.datasourceUid === binding.datasourceUid),
      ),
      message: binding.datasourceUid
        ? `expected resource tree to bind datasource ${binding.datasourceUid} through ${binding.source}`
        : `expected resource tree to include ${binding.source} binding`,
    })),
    ...(scenario.rubric.requiredText ?? []).map((text) => ({
      name: `text:${text}`,
      pass: JSON.stringify(candidate).includes(text),
      message: `expected resource document to contain UI text ${text}`,
    })),
    ...(scenario.rubric.forbiddenKindPrefixes ?? []).map((prefix) => ({
      name: `forbidden-prefix:${prefix}`,
      pass: collectKinds(candidate).every((kind) => !kind.startsWith(prefix)),
      message: `expected resource tree not to include kinds starting with ${prefix}`,
    })),
  ]
  const passedChecks = checks.filter((check) => check.pass).length
  const validationScore = validation.valid ? 50 : 0
  const rubricScore = checks.length === 0 ? 50 : Math.round((passedChecks / checks.length) * 50)
  return {
    valid: validation.valid && checks.every((check) => check.pass),
    score: validationScore + rubricScore,
    issues: validation.issues,
    checks,
  }
}

function collectKinds(resource: LoykinResource, kinds: string[] = []): string[] {
  kinds.push(resource.kind)
  for (const slot of resource.slots ?? []) {
    for (const child of slot.children) collectKinds(child, kinds)
  }
  return kinds
}

function collectVariables(resource: LoykinResource, variables: string[] = []): string[] {
  const spec = resource.spec
  if (isRecord(spec)) {
    if (Array.isArray(spec.variables)) {
      for (const item of spec.variables) {
        if (isRecord(item) && typeof item.name === 'string') variables.push(item.name)
      }
    }
    variables.push(...scanVariableRefs(spec))
    JSON.stringify(spec).replace(/"variables\.([^"]+)"/g, (_match, name: string) => {
      variables.push(name)
      return ''
    })
  }
  for (const slot of resource.slots ?? []) {
    for (const child of slot.children) collectVariables(child, variables)
  }
  return [...new Set(variables)]
}

function collectEventNames(resource: LoykinResource, events: string[] = []): string[] {
  if (isRecord(resource.spec) && isRecord(resource.spec.events)) {
    events.push(...Object.keys(resource.spec.events))
  }
  for (const slot of resource.slots ?? []) {
    for (const child of slot.children) collectEventNames(child, events)
  }
  return [...new Set(events)]
}

function collectBindings(resource: LoykinResource, bindings: Array<{ source: string; datasourceUid?: string }> = []): Array<{ source: string; datasourceUid?: string }> {
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.source === 'string') {
      bindings.push({
        source: value.source,
        datasourceUid: typeof value.datasourceUid === 'string' ? value.datasourceUid : undefined,
      })
    }
    Object.values(value).forEach(visit)
  }

  visit(resource.spec)
  for (const slot of resource.slots ?? []) {
    for (const child of slot.children) collectBindings(child, bindings)
  }
  return bindings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
