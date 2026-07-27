import { buildDocumentSchema, scanVariableRefs, validateResource } from '../../src'
import type { JsonSchema, Resource, ResourceRegistry, ScopeOptions, ValidationIssue } from '../../src'
import type { KindRenderFn } from '../../src/react'

export interface ScenarioDefinition<TSeed = unknown> {
  id: string
  prompt: string
  scope: ScopeOptions
  seedData: TSeed
  expectedResource: Resource
  rubric: ScenarioRubric
}

export interface ScenarioRubric {
  requiredKinds: string[]
  requiredVariables?: string[]
  requiredEvents?: string[]
  requiredBindings?: Array<{ kind: string; datasourceUid?: string }>
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
  candidate: Resource,
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
      name: binding.datasourceUid ? `binding:${binding.kind}:${binding.datasourceUid}` : `binding:${binding.kind}`,
      pass: collectBindings(candidate).some(
        (candidateBinding) =>
          candidateBinding.kind === binding.kind &&
          (binding.datasourceUid === undefined || candidateBinding.datasourceUid === binding.datasourceUid),
      ),
      message: binding.datasourceUid
        ? `expected resource tree to bind datasource ${binding.datasourceUid} through ${binding.kind}`
        : `expected resource tree to include ${binding.kind} binding`,
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

function collectKinds(resource: Resource, kinds: string[] = []): string[] {
  kinds.push(resource.kind)
  for (const slot of resource.slots ?? []) {
    for (const child of slot.items) collectKinds(child, kinds)
  }
  return kinds
}

function collectVariables(resource: Resource, variables: string[] = []): string[] {
  for (const declaration of resource.variables ?? []) {
    variables.push(declaration.name)
  }
  if (isRecord(resource.spec)) {
    variables.push(...scanVariableRefs(resource.spec))
    JSON.stringify(resource.spec).replace(/"variables\.([^"]+)"/g, (_match, name: string) => {
      variables.push(name)
      return ''
    })
  }
  for (const slot of resource.slots ?? []) {
    for (const child of slot.items) collectVariables(child, variables)
  }
  return [...new Set(variables)]
}

function collectEventNames(resource: Resource, events: string[] = []): string[] {
  if (resource.events) events.push(...Object.keys(resource.events))
  for (const slot of resource.slots ?? []) {
    for (const child of slot.items) collectEventNames(child, events)
  }
  return [...new Set(events)]
}

function collectBindings(resource: Resource, bindings: Array<{ kind: string; datasourceUid?: string }> = []): Array<{ kind: string; datasourceUid?: string }> {
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.apiVersion === 'string' && typeof value.kind === 'string' && 'spec' in value) {
      const spec = value.spec
      bindings.push({
        kind: value.kind,
        datasourceUid: isRecord(spec) && typeof spec.datasourceUid === 'string' ? spec.datasourceUid : undefined,
      })
    }
    Object.values(value).forEach(visit)
  }

  visit(resource.spec)
  if (resource.record) visit(resource.record)
  for (const slot of resource.slots ?? []) {
    for (const child of slot.items) collectBindings(child, bindings)
  }
  return bindings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
