import Ajv from 'ajv'
import type { ErrorObject } from 'ajv'
import { scanVariableRefs } from './variables'
import type { LoykinResource, ScopeOptions, SlotRule, ValidationIssue, ValidationResult, VariableDeclaration } from './types'
import type { ResourceRegistry, ScopedRegistry } from './registry'

const ajv = new Ajv({ allErrors: true, strict: false })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scopedOptions(registry: ResourceRegistry | ScopedRegistry): ScopeOptions | undefined {
  return 'options' in registry ? registry.options : undefined
}

function addIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message })
}

function formatAjvError(error: ErrorObject): string {
  const field = error.instancePath || '/'
  return `${field} ${error.message ?? 'is invalid'}`
}

function validateEnvelope(resource: unknown, path: string, issues: ValidationIssue[]): resource is LoykinResource {
  if (!isRecord(resource)) {
    addIssue(issues, path, 'resource must be an object')
    return false
  }
  if (typeof resource.apiVersion !== 'string') addIssue(issues, `${path}/apiVersion`, 'apiVersion must be a string')
  if (typeof resource.kind !== 'string') addIssue(issues, `${path}/kind`, 'kind must be a string')
  if (!('spec' in resource)) addIssue(issues, `${path}/spec`, 'spec is required')
  if ('metadata' in resource && !isRecord(resource.metadata)) addIssue(issues, `${path}/metadata`, 'metadata must be an object')
  if ('slots' in resource && !Array.isArray(resource.slots)) addIssue(issues, `${path}/slots`, 'slots must be an array')
  return typeof resource.apiVersion === 'string' && typeof resource.kind === 'string' && 'spec' in resource
}

function validateSpec(resource: LoykinResource, registry: ResourceRegistry | ScopedRegistry, path: string, issues: ValidationIssue[]): void {
  const manifest = registry.getKind(resource.apiVersion, resource.kind)
  if (!manifest) return

  const validate = ajv.compile(manifest.specSchema)
  if (validate(resource.spec)) return
  for (const error of validate.errors ?? []) {
    addIssue(issues, `${path}/spec${error.instancePath}`, formatAjvError(error))
  }
}

function slotName(slot: unknown): string | undefined {
  if (!isRecord(slot)) return undefined
  return typeof slot.name === 'string' ? slot.name : undefined
}

function children(slot: unknown): unknown[] {
  if (!isRecord(slot) || !Array.isArray(slot.items)) return []
  return slot.items
}

function validateRule(
  rule: SlotRule,
  slot: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  const count = children(slot).length
  if (rule.min !== undefined && count < rule.min) addIssue(issues, path, `slot must contain at least ${rule.min} child resource(s)`)
  if (rule.max !== undefined && count > rule.max) addIssue(issues, path, `slot must contain at most ${rule.max} child resource(s)`)

  if (rule.accepts) {
    children(slot).forEach((child, index) => {
      if (isRecord(child) && typeof child.kind === 'string' && !rule.accepts?.includes(child.kind)) {
        addIssue(issues, `${path}/items/${index}/kind`, `kind ${child.kind} is not accepted by this slot`)
      }
    })
  }
}

function validateSlots(resource: LoykinResource, registry: ResourceRegistry | ScopedRegistry, path: string, issues: ValidationIssue[]): void {
  const manifest = registry.getKind(resource.apiVersion, resource.kind)
  if (!manifest) return

  const slots = resource.slots ?? []
  if (!manifest.slotPolicy) {
    if (slots.length > 0) addIssue(issues, `${path}/slots`, `kind ${resource.kind} does not accept slots`)
    return
  }

  slots.forEach((slot, index) => {
    if (!isRecord(slot)) {
      addIssue(issues, `${path}/slots/${index}`, 'slot must be an object')
      return
    }
    if (!Array.isArray(slot.items)) {
      addIssue(issues, `${path}/slots/${index}/items`, 'slot items must be an array')
      return
    }

    const name = slotName(slot)
    const rule = name === undefined ? manifest.slotPolicy?.defaultSlot : manifest.slotPolicy?.slots?.[name]
    if (!rule) {
      addIssue(issues, `${path}/slots/${index}/name`, name === undefined ? 'default slot is not accepted' : `slot ${name} is not accepted`)
      return
    }
    validateRule(rule, slot, `${path}/slots/${index}`, issues)
  })
}

function variableDeclarations(spec: unknown): VariableDeclaration[] {
  if (!isRecord(spec) || !Array.isArray(spec.variables)) return []
  return spec.variables.filter((item): item is VariableDeclaration => isRecord(item) && typeof item.name === 'string')
}

function scanValueRefs(value: unknown): Set<string> {
  const refs = new Set<string>()
  const visit = (current: unknown) => {
    if (typeof current === 'string' && current.startsWith('variables.')) refs.add(current.slice('variables.'.length))
    if (Array.isArray(current)) current.forEach(visit)
    if (isRecord(current)) Object.values(current).forEach(visit)
  }
  visit(value)
  return refs
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateScopedCapabilities(resource: LoykinResource, options: ScopeOptions | undefined, path: string, depth: number, issues: ValidationIssue[]): void {
  if (!options) return
  if (options.maxDepth !== undefined && depth > options.maxDepth) {
    addIssue(issues, path, `resource depth exceeds maxDepth ${options.maxDepth}`)
  }

  const variableAllow = options.variables?.allow
  if (variableAllow) {
    for (const name of scanVariableRefs(resource.spec)) {
      if (!variableAllow.includes(name)) addIssue(issues, `${path}/spec`, `variable ${name} is not allowed in this scope`)
    }
    for (const name of scanValueRefs(resource.spec)) {
      if (!variableAllow.includes(name)) addIssue(issues, `${path}/spec`, `variable ${name} is not allowed in this scope`)
    }
    for (const declaration of variableDeclarations(resource.spec)) {
      if (!variableAllow.includes(declaration.name)) addIssue(issues, `${path}/spec/variables`, `variable ${declaration.name} is not allowed in this scope`)
    }
  }

  for (const [name, value] of Object.entries(options.variables?.lock ?? {})) {
    for (const declaration of variableDeclarations(resource.spec)) {
      if (declaration.name === name && declaration.default !== undefined && !sameJsonValue(declaration.default, value)) {
        addIssue(issues, `${path}/spec/variables`, `locked variable ${name} cannot be overridden`)
      }
    }
  }
}

function validateDatasourceAndActions(resource: LoykinResource, registry: ResourceRegistry | ScopedRegistry, path: string, issues: ValidationIssue[]): void {
  const options = scopedOptions(registry)
  const visit = (current: unknown, currentPath: string) => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPath}/${index}`))
      return
    }
    if (!isRecord(current)) return

    if (typeof current.source === 'string') {
      if (!registry.getDataResolver(current.source)) {
        addIssue(issues, `${currentPath}/source`, `data resolver ${current.source} is not registered`)
      }
      if (
        current.source === 'datasource' &&
        options?.datasources?.allow &&
        typeof current.datasourceUid === 'string' &&
        !options.datasources.allow.includes(current.datasourceUid)
      ) {
        addIssue(issues, `${currentPath}/datasourceUid`, `datasource ${current.datasourceUid} is not allowed in this scope`)
      }
    }

    if (current.kind === 'action' && typeof current.action === 'string' && options?.actions?.allow && !options.actions.allow.includes(current.action)) {
      addIssue(issues, `${currentPath}/action`, `action ${current.action} is not allowed in this scope`)
    }

    Object.entries(current).forEach(([key, item]) => visit(item, `${currentPath}/${key}`))
  }

  visit(resource.spec, `${path}/spec`)
}

/**
 * Layered validation. Layers:
 *
 * 1. Validate the common resource envelope.
 * 2. Look up `apiVersion` and `kind`.
 * 3. Validate `spec` with the kind's schema.
 * 4. Validate slots with the kind's slot policy.
 * 5. Validate child resources recursively.
 * 6. Validate scoped capability constraints.
 * 7. Validate datasource and action allowlists.
 */
export function validateResource(
  resource: LoykinResource,
  registry: ResourceRegistry | ScopedRegistry,
): ValidationResult {
  const issues: ValidationIssue[] = []
  const options = scopedOptions(registry)

  const visit = (current: unknown, path: string, depth: number) => {
    if (!validateEnvelope(current, path, issues)) return
    validateScopedCapabilities(current, options, path, depth, issues)
    const manifest = registry.getKind(current.apiVersion, current.kind)
    if (!manifest) {
      addIssue(issues, `${path}/kind`, `kind ${current.apiVersion}/${current.kind} is not registered or not allowed in this scope`)
    } else {
      validateSpec(current, registry, path, issues)
      validateSlots(current, registry, path, issues)
      validateDatasourceAndActions(current, registry, path, issues)
    }

    current.slots?.forEach((slot, slotIndex) => {
      children(slot).forEach((child, childIndex) => visit(child, `${path}/slots/${slotIndex}/children/${childIndex}`, depth + 1))
    })
  }

  visit(resource, '', 0)
  return { valid: issues.length === 0, issues }
}
