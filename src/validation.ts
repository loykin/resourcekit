import Ajv from 'ajv'
import type { ErrorObject } from 'ajv'
import { isDataRef, scanDataRefs, validateDataGraph } from './dataflow'
import type { ResourceDocument } from './dataflow'
import { scanVariableRefs } from './variables'
import type { Resource, ScopeOptions, SlotRule, ValidationIssue, ValidationResult, VariableDeclaration } from './types'
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

function intersectsLevel(level: string[] | undefined, allowed: string[]): boolean {
  return level?.some((value) => allowed.includes(value)) ?? false
}

function formatAjvError(error: ErrorObject): string {
  const field = error.instancePath || '/'
  return `${field} ${error.message ?? 'is invalid'}`
}

function validateEnvelope(resource: unknown, path: string, issues: ValidationIssue[]): resource is Resource {
  if (!isRecord(resource)) {
    addIssue(issues, path, 'resource must be an object')
    return false
  }
  if (typeof resource.apiVersion !== 'string') addIssue(issues, `${path}/apiVersion`, 'apiVersion must be a string')
  if (typeof resource.kind !== 'string') addIssue(issues, `${path}/kind`, 'kind must be a string')
  if (!('spec' in resource)) addIssue(issues, `${path}/spec`, 'spec is required')
  if ('metadata' in resource && !isRecord(resource.metadata)) addIssue(issues, `${path}/metadata`, 'metadata must be an object')
  if ('bindings' in resource && !isRecord(resource.bindings)) addIssue(issues, `${path}/bindings`, 'bindings must be an object')
  if ('slots' in resource && !Array.isArray(resource.slots)) addIssue(issues, `${path}/slots`, 'slots must be an array')
  return typeof resource.apiVersion === 'string' && typeof resource.kind === 'string' && 'spec' in resource
}

function validateBindings(resource: Resource, registry: ResourceRegistry | ScopedRegistry, path: string, issues: ValidationIssue[]): void {
  const manifest = registry.getKind(resource.apiVersion, resource.kind)
  if (!manifest) return
  const bindings = resource.bindings ?? {}
  const ports = manifest.bindingPolicy?.inputs ?? {}
  const variableAllow = scopedOptions(registry)?.variables?.allow

  for (const [name, value] of Object.entries(bindings)) {
    if (!(name in ports)) {
      addIssue(issues, `${path}/bindings/${name}`, `binding ${name} is not declared by kind ${resource.kind}`)
      continue
    }
    if (isDataRef(value)) continue
    if (isRecord(value) && typeof value.$variable === 'string' && Object.keys(value).length === 1) {
      if (variableAllow && !variableAllow.includes(value.$variable)) {
        addIssue(issues, `${path}/bindings/${name}/$variable`, `variable ${value.$variable} is not allowed in this scope`)
      }
      continue
    }
    addIssue(issues, `${path}/bindings/${name}`, 'binding must be a data or variable reference')
  }

  for (const [name, port] of Object.entries(ports)) {
    if (port.required && !(name in bindings)) addIssue(issues, `${path}/bindings/${name}`, `binding ${name} is required`)
  }
}

function validateSpec(resource: Resource, registry: ResourceRegistry | ScopedRegistry, path: string, issues: ValidationIssue[]): void {
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
  registry: ResourceRegistry | ScopedRegistry,
  issues: ValidationIssue[],
): void {
  const count = children(slot).length
  if (rule.min !== undefined && count < rule.min) addIssue(issues, path, `slot must contain at least ${rule.min} child resource(s)`)
  if (rule.max !== undefined && count > rule.max) addIssue(issues, path, `slot must contain at most ${rule.max} child resource(s)`)

  if (rule.accepts || rule.acceptsLevels) {
    children(slot).forEach((child, index) => {
      if (!isRecord(child) || typeof child.kind !== 'string') return
      const acceptedByName = rule.accepts?.includes(child.kind) ?? false
      const manifest = typeof child.apiVersion === 'string' ? registry.getKind(child.apiVersion, child.kind) : undefined
      const acceptedByLevel = rule.acceptsLevels ? intersectsLevel(manifest?.level, rule.acceptsLevels) : false
      if (!acceptedByName && !acceptedByLevel) {
        addIssue(issues, `${path}/items/${index}/kind`, `kind ${child.kind} is not accepted by this slot`)
      }
    })
  }
}

function validateSlots(resource: Resource, registry: ResourceRegistry | ScopedRegistry, path: string, issues: ValidationIssue[]): void {
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
    validateRule(rule, slot, `${path}/slots/${index}`, registry, issues)
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

function validateScopedCapabilities(resource: Resource, options: ScopeOptions | undefined, path: string, depth: number, issues: ValidationIssue[]): void {
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

function validateDatasourceAndActions(resource: Resource, registry: ResourceRegistry | ScopedRegistry, path: string, issues: ValidationIssue[]): void {
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
  resource: Resource,
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
      if (depth === 0 && options?.rootLevels && !intersectsLevel(manifest.level, options.rootLevels)) {
        addIssue(issues, `${path}/kind`, `kind ${current.kind} is not an allowed root level`)
      }
      validateSpec(current, registry, path, issues)
      validateBindings(current, registry, path, issues)
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

/** Layered validation for the experimental ResourceDocument data graph plus its root resource. */
export function validateResourceDocument(
  document: ResourceDocument,
  registry: ResourceRegistry | ScopedRegistry,
): ValidationResult {
  const resourceValidation = validateResource(document.resource, registry)
  const issues = [...resourceValidation.issues]
  const graph = document.data
  if (!graph) return { valid: issues.length === 0, issues }

  for (const issue of validateDataGraph(graph).issues) {
    addIssue(issues, `/${issue.path.split('.').join('/')}`, issue.message)
  }

  const options = scopedOptions(registry)
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== 'resolve') continue
    if (!registry.getDataResolver(node.binding.source)) {
      addIssue(issues, `/data/nodes/${id}/binding/source`, `data resolver ${node.binding.source} is not registered`)
    }
    if (
      node.binding.source === 'datasource' &&
      options?.datasources?.allow &&
      'datasourceUid' in node.binding &&
      typeof node.binding.datasourceUid === 'string' &&
      !options.datasources.allow.includes(node.binding.datasourceUid)
    ) {
      addIssue(issues, `/data/nodes/${id}/binding/datasourceUid`, `datasource ${node.binding.datasourceUid} is not allowed in this scope`)
    }
    if (
      node.binding.source === 'connection' &&
      options?.connections?.allow &&
      'connection' in node.binding &&
      typeof node.binding.connection === 'string' &&
      !options.connections.allow.includes(node.binding.connection)
    ) {
      addIssue(issues, `/data/nodes/${id}/binding/connection`, `connection ${node.binding.connection} is not allowed in this scope`)
    }
  }

  for (const ref of scanDataRefs(document.resource)) {
    if (!(ref.$data in graph.nodes)) addIssue(issues, '/resource', `referenced data node ${ref.$data} does not exist`)
  }

  const visitPolicies = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visitPolicies(item, `${path}/${index}`))
      return
    }
    if (!isRecord(value)) return
    if (typeof value.apiVersion === 'string' && typeof value.kind === 'string' && isRecord(value.bindings)) {
      const manifest = registry.getKind(value.apiVersion, value.kind)
      for (const [name, binding] of Object.entries(value.bindings)) {
        if (!manifest?.bindingPolicy?.inputs[name]?.writable || !isDataRef(binding)) continue
        if (graph.nodes[binding.$data]?.kind !== 'state') {
          addIssue(issues, `${path}/bindings/${name}`, `writable binding ${name} must reference a state node`)
        }
      }
    }
    if (value.kind === 'setData' && typeof value.node === 'string' && graph.nodes[value.node]?.kind !== 'state') {
      addIssue(issues, `${path}/node`, `data node ${value.node} is not writable state`)
    }
    Object.entries(value).forEach(([key, item]) => visitPolicies(item, `${path}/${key}`))
  }
  visitPolicies(document.resource, '/resource')

  return { valid: issues.length === 0, issues }
}
