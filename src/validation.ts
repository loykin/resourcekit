import Ajv from 'ajv'
import type { ErrorObject } from 'ajv'
import { isDataRef, scanDataRefs, validateDataGraph } from './dataflow'
import type { ResourceDocument } from './dataflow'
import { scanVariableRefs } from './variables'
import { listExampleEntries } from './examples'
import type { Resource, ScopeOptions, SlotRule, ValidationIssue, ValidationResult, VariableDeclaration } from './types'
import type { ResourceRegistry, ScopedRegistry } from './registry'

export interface ExampleValidationFailure {
  /** e.g. "kind:resourcekit.dev/v1alpha1/Panel#0" or "pattern:master-detail". */
  source: string
  issues: ValidationIssue[]
}

/**
 * CI enforcement for generation-quality.md's example infrastructure:
 * "examples = test fixtures = docs." Every registered kind and pattern
 * example must independently pass `validateResource` — a broken example is
 * exactly the kind of schema-drift breakage that should fail a build, not
 * silently keep teaching an AI (or a human) something that no longer works.
 */
export function validateAllExamples(registry: ResourceRegistry | ScopedRegistry): ExampleValidationFailure[] {
  const failures: ExampleValidationFailure[] = []
  const entries = listExampleEntries(registry)

  for (const { manifest, index, example } of entries.kindExamples) {
    const result = validateResource(example.resource, registry)
    if (!result.valid) failures.push({ source: `kind:${manifest.apiVersion}/${manifest.kind}#${index}`, issues: result.issues })
  }

  for (const example of entries.patternExamples) {
    const result = validateResource(example.resource, registry)
    if (!result.valid) failures.push({ source: `pattern:${example.name}`, issues: result.issues })
  }

  return failures
}

const ajv = new Ajv({ allErrors: true, strict: false })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scopedOptions(registry: ResourceRegistry | ScopedRegistry): ScopeOptions | undefined {
  return 'options' in registry ? registry.options : undefined
}

function addIssue(issues: ValidationIssue[], path: string, message: string, hint?: string): void {
  issues.push(hint ? { path, message, hint } : { path, message })
}

function intersectsLevel(level: string[] | undefined, allowed: string[]): boolean {
  return level?.some((value) => allowed.includes(value)) ?? false
}

function formatAjvError(error: ErrorObject): { message: string; hint: string } {
  const field = error.instancePath || '/'
  return { message: `${field} ${error.message ?? 'is invalid'}`, hint: `fix ${field || 'the spec'} to match the kind's spec schema (see singleKindSchema(scope, apiVersion, kind))` }
}

function validateEnvelope(resource: unknown, path: string, issues: ValidationIssue[]): resource is Resource {
  if (!isRecord(resource)) {
    addIssue(issues, path, 'resource must be an object', 'provide a JSON object with apiVersion, kind, and spec')
    return false
  }
  if (typeof resource.apiVersion !== 'string') {
    addIssue(issues, `${path}/apiVersion`, 'apiVersion must be a string', "set apiVersion to the kind's registered API version, e.g. \"resourcekit.dev/v1alpha1\"")
  }
  if (typeof resource.kind !== 'string') addIssue(issues, `${path}/kind`, 'kind must be a string', 'set kind to a registered kind name')
  if (!('spec' in resource)) addIssue(issues, `${path}/spec`, 'spec is required', "add a spec object matching the kind's spec schema")
  if ('metadata' in resource && !isRecord(resource.metadata)) {
    addIssue(issues, `${path}/metadata`, 'metadata must be an object', 'remove metadata or replace it with an object')
  }
  if ('bindings' in resource && !isRecord(resource.bindings)) {
    addIssue(issues, `${path}/bindings`, 'bindings must be an object', 'remove bindings or replace it with an object of { inputName: dataOrVariableRef }')
  }
  if ('slots' in resource && !Array.isArray(resource.slots)) {
    addIssue(issues, `${path}/slots`, 'slots must be an array', 'wrap slot entries in an array: [{ items: [...] }]')
  }
  if ('visible' in resource) validateVisibilityCondition(resource.visible, `${path}/visible`, issues)
  return typeof resource.apiVersion === 'string' && typeof resource.kind === 'string' && 'spec' in resource
}

function validateVisibilityCondition(condition: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(condition)) {
    addIssue(issues, path, 'visible must reference a page variable or combine conditions with $and/$or/$not', 'use { "$variable": "name" } or { "$and": [...] }/{ "$or": [...] }/{ "$not": {...} }')
    return
  }
  if ('$and' in condition || '$or' in condition) {
    const key = '$and' in condition ? '$and' : '$or'
    const children = (condition as Record<string, unknown>)[key]
    if (!Array.isArray(children)) {
      addIssue(issues, path, `visible.${key} must be an array of conditions`, `wrap the conditions in an array: { "${key}": [...] }`)
      return
    }
    children.forEach((child, index) => validateVisibilityCondition(child, `${path}/${key}/${index}`, issues))
    return
  }
  if ('$not' in condition) {
    validateVisibilityCondition((condition as Record<string, unknown>).$not, `${path}/$not`, issues)
    return
  }
  if (typeof condition.$variable !== 'string') {
    addIssue(issues, path, 'visible must reference a page variable', 'use { "$variable": "name" } with optional equals or contains')
    return
  }
  const hasEquals = 'equals' in condition
  const hasContains = 'contains' in condition
  if (hasEquals && typeof condition.equals !== 'string') {
    addIssue(issues, `${path}/equals`, 'visible.equals must be a string', 'use a string value that can be compared with the page variable')
  }
  if (hasContains && typeof condition.contains !== 'string') {
    addIssue(issues, `${path}/contains`, 'visible.contains must be a string', 'use a string member expected in the page variable array')
  }
  if (hasEquals && hasContains) {
    addIssue(issues, path, 'visible cannot use equals and contains together', 'keep exactly one comparison operator')
  }
  const extra = Object.keys(condition).filter((key) => !['$variable', 'equals', 'contains'].includes(key))
  if (extra.length > 0) addIssue(issues, path, `visible has unknown field ${extra[0]}`, 'use only $variable, equals, or contains')
}

function validateBindings(resource: Resource, registry: ResourceRegistry | ScopedRegistry, path: string, issues: ValidationIssue[]): void {
  const manifest = registry.getKind(resource.apiVersion, resource.kind)
  if (!manifest) return
  const bindings = resource.bindings ?? {}
  const ports = manifest.bindingPolicy?.inputs ?? {}
  const variableAllow = scopedOptions(registry)?.variables?.allow

  for (const [name, value] of Object.entries(bindings)) {
    if (!(name in ports)) {
      addIssue(
        issues,
        `${path}/bindings/${name}`,
        `binding ${name} is not declared by kind ${resource.kind}`,
        `remove this binding, or use one of: ${Object.keys(ports).join(', ') || '(this kind declares no binding ports)'}`,
      )
      continue
    }
    if (isDataRef(value)) continue
    if (isRecord(value) && typeof value.$variable === 'string' && Object.keys(value).length === 1) {
      if (variableAllow && !variableAllow.includes(value.$variable)) {
        addIssue(
          issues,
          `${path}/bindings/${name}/$variable`,
          `variable ${value.$variable} is not allowed in this scope`,
          `use one of the scope's allowed variables: ${variableAllow.join(', ') || '(none allowed)'}`,
        )
      }
      continue
    }
    addIssue(issues, `${path}/bindings/${name}`, 'binding must be a data or variable reference', 'use { "$data": "nodeId" } or { "$variable": "name" }')
  }

  for (const [name, port] of Object.entries(ports)) {
    if (port.required && !(name in bindings)) {
      addIssue(issues, `${path}/bindings/${name}`, `binding ${name} is required`, `add a binding for ${name}: ${port.description}`)
    }
  }
}

function validateSpec(resource: Resource, registry: ResourceRegistry | ScopedRegistry, path: string, issues: ValidationIssue[]): void {
  const manifest = registry.getKind(resource.apiVersion, resource.kind)
  if (!manifest) return

  const validate = ajv.compile(manifest.specSchema)
  if (validate(resource.spec)) return
  for (const error of validate.errors ?? []) {
    const { message, hint } = formatAjvError(error)
    addIssue(issues, `${path}/spec${error.instancePath}`, message, hint)
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
  if (rule.min !== undefined && count < rule.min) {
    addIssue(issues, path, `slot must contain at least ${rule.min} child resource(s)`, `add ${rule.min - count} more child resource(s) to this slot's items`)
  }
  if (rule.max !== undefined && count > rule.max) {
    addIssue(issues, path, `slot must contain at most ${rule.max} child resource(s)`, `remove ${count - rule.max} child resource(s) from this slot's items`)
  }

  if (rule.accepts || rule.acceptsLevels) {
    children(slot).forEach((child, index) => {
      if (!isRecord(child) || typeof child.kind !== 'string') return
      const acceptedByName = rule.accepts?.includes(child.kind) ?? false
      const manifest = typeof child.apiVersion === 'string' ? registry.getKind(child.apiVersion, child.kind) : undefined
      const acceptedByLevel = rule.acceptsLevels ? intersectsLevel(manifest?.level, rule.acceptsLevels) : false
      if (!acceptedByName && !acceptedByLevel) {
        addIssue(
          issues,
          `${path}/items/${index}/kind`,
          `kind ${child.kind} is not accepted by this slot`,
          `use a kind from this slot's accepted list${rule.accepts ? `: ${rule.accepts.join(', ')}` : ''}`,
        )
      }
    })
  }
}

function validateSlots(resource: Resource, registry: ResourceRegistry | ScopedRegistry, path: string, issues: ValidationIssue[]): void {
  const manifest = registry.getKind(resource.apiVersion, resource.kind)
  if (!manifest) return

  const slots = resource.slots ?? []
  if (!manifest.slotPolicy) {
    if (slots.length > 0) addIssue(issues, `${path}/slots`, `kind ${resource.kind} does not accept slots`, 'remove the slots field from this leaf resource')
    return
  }

  const declaredSlotNames = Object.keys(manifest.slotPolicy.slots ?? {})
  const seenCounts = new Map<string | undefined, number>()

  slots.forEach((slot, index) => {
    if (!isRecord(slot)) {
      addIssue(issues, `${path}/slots/${index}`, 'slot must be an object', 'each slot entry must be { name?: string, items: Resource[] }')
      return
    }
    if (!Array.isArray(slot.items)) {
      addIssue(issues, `${path}/slots/${index}/items`, 'slot items must be an array', 'wrap child resources in an items array')
      return
    }

    const name = slotName(slot)
    const rule = name === undefined ? manifest.slotPolicy?.defaultSlot : manifest.slotPolicy?.slots?.[name]
    if (!rule) {
      addIssue(
        issues,
        `${path}/slots/${index}/name`,
        name === undefined ? 'default slot is not accepted' : `slot ${name} is not accepted`,
        manifest.slotPolicy?.defaultSlot
          ? `omit name to use the default slot${declaredSlotNames.length > 0 ? `, or use one of: ${declaredSlotNames.join(', ')}` : ''}`
          : `use one of this kind's declared slots: ${declaredSlotNames.join(', ') || '(none declared)'}`,
      )
      return
    }

    // A renderer keeps only the last slot with a given name (Map.set
    // semantics) — a second declaration silently discards the first one's
    // children, so it must fail validation instead of passing quietly.
    const priorCount = seenCounts.get(name) ?? 0
    if (priorCount > 0) {
      addIssue(
        issues,
        `${path}/slots/${index}`,
        name === undefined ? 'default slot is declared more than once' : `slot ${name} is declared more than once`,
        'merge these into a single slot entry — only the last slot with this name is rendered',
      )
    }
    seenCounts.set(name, priorCount + 1)

    validateRule(rule, slot, `${path}/slots/${index}`, registry, issues)
  })

  // validateRule only checks min/max for slots that are *present* — a
  // required slot (min > 0) that's missing from `resource.slots` entirely
  // never reaches that check, so it has to be caught here instead.
  const declaredRules: Array<[string | undefined, SlotRule]> = [
    ...(manifest.slotPolicy.defaultSlot ? ([[undefined, manifest.slotPolicy.defaultSlot]] as Array<[string | undefined, SlotRule]>) : []),
    ...Object.entries(manifest.slotPolicy.slots ?? {}),
  ]
  for (const [name, rule] of declaredRules) {
    if (rule.min !== undefined && rule.min > 0 && !seenCounts.has(name)) {
      addIssue(
        issues,
        `${path}/slots`,
        name === undefined ? `default slot is required (min ${rule.min}) but missing` : `slot ${name} is required (min ${rule.min}) but missing`,
        name === undefined
          ? `add a slot entry with no name and at least ${rule.min} child resource(s)`
          : `add a slot entry named "${name}" with at least ${rule.min} child resource(s)`,
      )
    }
  }
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

function checkVisibilityScope(
  condition: Resource['visible'],
  path: string,
  variableAllow: string[],
  variableHint: () => string,
  issues: ValidationIssue[],
): void {
  if (!condition || !isRecord(condition)) return
  if ('$and' in condition || '$or' in condition) {
    const key = '$and' in condition ? '$and' : '$or'
    const children = (condition as Record<string, unknown>)[key]
    if (!Array.isArray(children)) return
    children.forEach((child, index) => checkVisibilityScope(child as Resource['visible'], `${path}/${key}/${index}`, variableAllow, variableHint, issues))
    return
  }
  if ('$not' in condition) {
    checkVisibilityScope((condition as Record<string, unknown>).$not as Resource['visible'], `${path}/$not`, variableAllow, variableHint, issues)
    return
  }
  if (typeof condition.$variable === 'string' && !variableAllow.includes(condition.$variable)) {
    addIssue(issues, `${path}/$variable`, `variable ${condition.$variable} is not allowed in this scope`, variableHint())
  }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateScopedCapabilities(resource: Resource, options: ScopeOptions | undefined, path: string, depth: number, issues: ValidationIssue[]): void {
  if (!options) return
  if (options.maxDepth !== undefined && depth > options.maxDepth) {
    addIssue(issues, path, `resource depth exceeds maxDepth ${options.maxDepth}`, `flatten this branch of the tree to at most ${options.maxDepth} levels deep`)
  }

  const variableAllow = options.variables?.allow
  const variableHint = () => `use one of the scope's allowed variables: ${variableAllow?.join(', ') || '(none allowed)'}`
  if (variableAllow) {
    if (resource.visible) checkVisibilityScope(resource.visible, `${path}/visible`, variableAllow, variableHint, issues)
    for (const name of scanVariableRefs(resource.spec)) {
      if (!variableAllow.includes(name)) addIssue(issues, `${path}/spec`, `variable ${name} is not allowed in this scope`, variableHint())
    }
    for (const name of scanValueRefs(resource.spec)) {
      if (!variableAllow.includes(name)) addIssue(issues, `${path}/spec`, `variable ${name} is not allowed in this scope`, variableHint())
    }
    for (const declaration of variableDeclarations(resource.spec)) {
      if (!variableAllow.includes(declaration.name)) {
        addIssue(issues, `${path}/spec/variables`, `variable ${declaration.name} is not allowed in this scope`, variableHint())
      }
    }
  }

  for (const [name, value] of Object.entries(options.variables?.lock ?? {})) {
    for (const declaration of variableDeclarations(resource.spec)) {
      if (declaration.name === name && declaration.default !== undefined && !sameJsonValue(declaration.default, value)) {
        addIssue(
          issues,
          `${path}/spec/variables`,
          `locked variable ${name} cannot be overridden`,
          `remove this variable's default, or set it to the scope-locked value: ${JSON.stringify(value)}`,
        )
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
        addIssue(
          issues,
          `${currentPath}/source`,
          `data resolver ${current.source} is not registered`,
          `register a resolver for "${current.source}", or use one of: ${registry.listDataResolvers().join(', ') || '(none registered)'}`,
        )
      }
      if (
        current.source === 'datasource' &&
        options?.datasources?.allow &&
        typeof current.datasourceUid === 'string' &&
        !options.datasources.allow.includes(current.datasourceUid)
      ) {
        addIssue(
          issues,
          `${currentPath}/datasourceUid`,
          `datasource ${current.datasourceUid} is not allowed in this scope`,
          `use one of the scope's allowed datasources: ${options.datasources.allow.join(', ') || '(none allowed)'}`,
        )
      }
      // Mirrors the same check the ResourceDocument data-graph path applies
      // to `resolve` nodes — a bare Resource's `spec.data`/binding tree must
      // not be able to reach a connection the document-graph path would
      // reject (test.md §5.2, ScopeOptions.connections.allow).
      if (
        current.source === 'connection' &&
        options?.connections?.allow &&
        typeof current.connection === 'string' &&
        !options.connections.allow.includes(current.connection)
      ) {
        addIssue(
          issues,
          `${currentPath}/connection`,
          `connection ${current.connection} is not allowed in this scope`,
          `use one of the scope's allowed connections: ${options.connections.allow.join(', ') || '(none allowed)'}`,
        )
      }
    }

    if (current.kind === 'action' && typeof current.action === 'string' && options?.actions?.allow && !options.actions.allow.includes(current.action)) {
      addIssue(
        issues,
        `${currentPath}/action`,
        `action ${current.action} is not allowed in this scope`,
        `use one of the scope's allowed actions: ${options.actions.allow.join(', ') || '(none allowed)'}`,
      )
    }
    if ('mutation' in current && typeof current.action === 'string' && options?.actions?.allow && !options.actions.allow.includes(current.action)) {
      addIssue(
        issues,
        `${currentPath}/action`,
        `action ${current.action} is not allowed in this scope`,
        `use one of the scope's allowed actions: ${options.actions.allow.join(', ') || '(none allowed)'}`,
      )
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
      addIssue(
        issues,
        `${path}/kind`,
        `kind ${current.apiVersion}/${current.kind} is not registered or not allowed in this scope`,
        'use a kind from this scope — call scope.listKinds() (or nextStage/nextStageBatch for staged generation) to see which are available',
      )
    } else {
      if (depth === 0 && options?.rootLevels && !intersectsLevel(manifest.level, options.rootLevels)) {
        addIssue(
          issues,
          `${path}/kind`,
          `kind ${current.kind} is not an allowed root level`,
          `use a root-level kind (level intersecting: ${options.rootLevels.join(', ')}), or nest ${current.kind} under an allowed root instead`,
        )
      }
      validateSpec(current, registry, path, issues)
      validateBindings(current, registry, path, issues)
      validateSlots(current, registry, path, issues)
      validateDatasourceAndActions(current, registry, path, issues)
    }

    current.slots?.forEach((slot, slotIndex) => {
      children(slot).forEach((child, childIndex) => visit(child, `${path}/slots/${slotIndex}/items/${childIndex}`, depth + 1))
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

  const dataGraphHints: Record<string, string> = {
    'invalid-node': 'give the node a non-empty id and a valid kind ("state" or "resolve")',
    'invalid-ref': 'a data reference must be exactly { "$data": "nodeId", "path"?: "string" } — no other keys',
    'missing-ref': `reference an existing node id: ${Object.keys(graph.nodes).join(', ') || '(no nodes declared)'}`,
    cycle: 'break the cycle — remove one of the listed edges so dependencies form a DAG',
  }
  for (const issue of validateDataGraph(graph).issues) {
    addIssue(issues, `/${issue.path.split('.').join('/')}`, issue.message, dataGraphHints[issue.code])
  }

  const options = scopedOptions(registry)
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== 'resolve') continue
    if (!registry.getDataResolver(node.binding.source)) {
      addIssue(
        issues,
        `/data/nodes/${id}/binding/source`,
        `data resolver ${node.binding.source} is not registered`,
        `register a resolver for "${node.binding.source}", or use one of: ${registry.listDataResolvers().join(', ') || '(none registered)'}`,
      )
    }
    if (
      node.binding.source === 'datasource' &&
      options?.datasources?.allow &&
      'datasourceUid' in node.binding &&
      typeof node.binding.datasourceUid === 'string' &&
      !options.datasources.allow.includes(node.binding.datasourceUid)
    ) {
      addIssue(
        issues,
        `/data/nodes/${id}/binding/datasourceUid`,
        `datasource ${node.binding.datasourceUid} is not allowed in this scope`,
        `use one of the scope's allowed datasources: ${options.datasources.allow.join(', ') || '(none allowed)'}`,
      )
    }
    if (
      node.binding.source === 'connection' &&
      options?.connections?.allow &&
      'connection' in node.binding &&
      typeof node.binding.connection === 'string' &&
      !options.connections.allow.includes(node.binding.connection)
    ) {
      addIssue(
        issues,
        `/data/nodes/${id}/binding/connection`,
        `connection ${node.binding.connection} is not allowed in this scope`,
        `use one of the scope's allowed connections: ${options.connections.allow.join(', ') || '(none allowed)'}`,
      )
    }
  }

  for (const ref of scanDataRefs(document.resource)) {
    if (!(ref.$data in graph.nodes)) {
      addIssue(
        issues,
        '/resource',
        `referenced data node ${ref.$data} does not exist`,
        `add a data node with id "${ref.$data}", or fix the $data reference to an existing node: ${Object.keys(graph.nodes).join(', ') || '(no nodes declared)'}`,
      )
    }
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
          addIssue(
            issues,
            `${path}/bindings/${name}`,
            `writable binding ${name} must reference a state node`,
            `point $data at a "state"-kind node, not "${graph.nodes[binding.$data]?.kind ?? 'an unknown node'}"`,
          )
        }
      }
    }
    if (value.kind === 'setData' && typeof value.node === 'string' && graph.nodes[value.node]?.kind !== 'state') {
      addIssue(
        issues,
        `${path}/node`,
        `data node ${value.node} is not writable state`,
        `target a "state"-kind node with setData, not "${graph.nodes[value.node]?.kind ?? 'an unknown node'}"`,
      )
    }
    if ((value.kind === 'invalidateData' || value.kind === 'refetchData') && Array.isArray(value.nodes)) {
      value.nodes.forEach((node, index) => {
        if (typeof node !== 'string' || graph.nodes[node]?.kind === 'resolve') return
        addIssue(
          issues,
          `${path}/nodes/${index}`,
          `data node ${String(node)} is not a resolvable query`,
          `target a "resolve"-kind node with ${value.kind}, not "${graph.nodes[String(node)]?.kind ?? 'an unknown node'}"`,
        )
      })
    }
    Object.entries(value).forEach(([key, item]) => visitPolicies(item, `${path}/${key}`))
  }
  visitPolicies(document.resource, '/resource')

  return { valid: issues.length === 0, issues }
}
