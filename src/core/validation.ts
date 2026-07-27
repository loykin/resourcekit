import Ajv from 'ajv'
import type { ErrorObject } from 'ajv'
import { isObjectStateRef } from '../runtime/objectState'
import { scanDataflowRefs } from '../dataflow/ref'
import { scanVariableRefs } from '../runtime/variables'
import { listExampleEntries } from './examples'
import type { DataflowUnit, Resource, ScopeOptions, SlotRule, ValidationIssue, ValidationResult, VariableDeclaration } from './types'
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
  if ('visible' in resource) validateVisibilityCondition(resource.visible, `${path}/visible`, 'visible', issues)
  if ('disabled' in resource) validateVisibilityCondition(resource.disabled, `${path}/disabled`, 'disabled', issues)
  if ('variables' in resource && !Array.isArray(resource.variables)) {
    addIssue(issues, `${path}/variables`, 'variables must be an array', 'remove variables or replace it with an array of variable declarations')
  }
  if ('events' in resource && !isRecord(resource.events)) {
    addIssue(issues, `${path}/events`, 'events must be an object', 'remove events or replace it with an object of { eventName: EventPolicy }')
  }
  if ('record' in resource && !isRecord(resource.record)) {
    addIssue(issues, `${path}/record`, 'record must be an object', 'remove record or replace it with a DataBinding or { "$state": "name" } object')
  }
  if ('objectState' in resource && !Array.isArray(resource.objectState)) {
    addIssue(issues, `${path}/objectState`, 'objectState must be an array', 'remove objectState or replace it with an array of { name, initialValue? } declarations')
  }
  if ('dataflow' in resource && !Array.isArray(resource.dataflow)) {
    addIssue(issues, `${path}/dataflow`, 'dataflow must be an array', 'remove dataflow or replace it with an array of { name, binding, policy?, dependOn? } units')
  }
  // `variables`/`events` are never legitimate spec content for any kind —
  // the runtime only ever reads them from the envelope. A kind whose own
  // specSchema allows additionalProperties would otherwise accept these
  // silently, and the runtime would just as silently never see them.
  if (isRecord(resource.spec)) {
    if ('variables' in resource.spec) {
      addIssue(issues, `${path}/spec/variables`, 'variables is not spec content', `move it to ${path}/variables — the runtime only reads variable declarations from the envelope, never from spec`)
    }
    if ('events' in resource.spec) {
      addIssue(issues, `${path}/spec/events`, 'events is not spec content', `move it to ${path}/events — the runtime only reads event policy from the envelope, never from spec`)
    }
  }
  return typeof resource.apiVersion === 'string' && typeof resource.kind === 'string' && 'spec' in resource
}

/** Shared by `visible` and `disabled` — both are `VisibilityCondition` envelopes evaluated the same way. `field` only affects message text. */
function validateVisibilityCondition(condition: unknown, path: string, field: 'visible' | 'disabled', issues: ValidationIssue[]): void {
  if (!isRecord(condition)) {
    addIssue(issues, path, `${field} must reference a page variable or combine conditions with $and/$or/$not`, 'use { "$variable": "name" } or { "$and": [...] }/{ "$or": [...] }/{ "$not": {...} }')
    return
  }
  if ('$and' in condition || '$or' in condition) {
    const key = '$and' in condition ? '$and' : '$or'
    const children = (condition as Record<string, unknown>)[key]
    if (!Array.isArray(children)) {
      addIssue(issues, path, `${field}.${key} must be an array of conditions`, `wrap the conditions in an array: { "${key}": [...] }`)
      return
    }
    children.forEach((child, index) => validateVisibilityCondition(child, `${path}/${key}/${index}`, field, issues))
    return
  }
  if ('$not' in condition) {
    validateVisibilityCondition((condition as Record<string, unknown>).$not, `${path}/$not`, field, issues)
    return
  }
  if (typeof condition.$variable !== 'string') {
    addIssue(issues, path, `${field} must reference a page variable`, 'use { "$variable": "name" } with optional equals or contains')
    return
  }
  const hasEquals = 'equals' in condition
  const hasContains = 'contains' in condition
  if (hasEquals && typeof condition.equals !== 'string') {
    addIssue(issues, `${path}/equals`, `${field}.equals must be a string`, 'use a string value that can be compared with the page variable')
  }
  if (hasContains && typeof condition.contains !== 'string') {
    addIssue(issues, `${path}/contains`, `${field}.contains must be a string`, 'use a string member expected in the page variable array')
  }
  if (hasEquals && hasContains) {
    addIssue(issues, path, `${field} cannot use equals and contains together`, 'keep exactly one comparison operator')
  }
  const extra = Object.keys(condition).filter((key) => !['$variable', 'equals', 'contains'].includes(key))
  if (extra.length > 0) addIssue(issues, path, `${field} has unknown field ${extra[0]}`, 'use only $variable, equals, or contains')
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
    if (isObjectStateRef(value)) continue
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
    addIssue(issues, `${path}/bindings/${name}`, 'binding must be an object-state or variable reference', 'use { "$state": "name" } or { "$variable": "name" }')
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

function variableDeclarations(resource: Resource): VariableDeclaration[] {
  return resource.variables ?? []
}

/** Same recursive-collection shape as `collectVariables`/`collectObjectState` in `ResourceRenderer.tsx` — `dataflow` is document-wide, not tree-bound. */
function collectDataflowUnits(resource: Resource, units: DataflowUnit[] = []): DataflowUnit[] {
  units.push(...(resource.dataflow ?? []))
  for (const slot of resource.slots ?? []) {
    for (const child of children(slot)) {
      if (isRecord(child)) collectDataflowUnits(child as unknown as Resource, units)
    }
  }
  return units
}

/**
 * `dependOn` is execution-order/lazy-gating only (never a value reference —
 * see AGENTS.md's hard rule), so this only needs to reject dangling names and
 * cycles, never compute a topological execution order. Model: dashboardkit's
 * `detectCycle` DFS-with-stack (`buildVariableDAG`,
 * /Users/loykin/Project/dashboardkit/src/query/dag.ts), adapted to report via
 * `ValidationIssue` instead of throwing.
 */
function validateDataflowGraph(units: DataflowUnit[], issues: ValidationIssue[]): void {
  const seen = new Set<string>()
  for (const unit of units) {
    if (seen.has(unit.name)) {
      addIssue(issues, '/dataflow', `dataflow unit name ${unit.name} is declared more than once`, 'give each dataflow unit a unique name — a duplicate would silently overwrite the first in the engine')
    }
    seen.add(unit.name)
  }

  const names = new Set(units.map((unit) => unit.name))
  const deps = new Map(units.map((unit) => [unit.name, unit.dependOn ?? []]))

  for (const unit of units) {
    for (const dep of unit.dependOn ?? []) {
      if (!names.has(dep)) {
        addIssue(issues, '/dataflow', `dataflow unit ${unit.name} depends on undeclared unit ${dep}`, `declare a dataflow unit named "${dep}", or remove it from ${unit.name}'s dependOn`)
      }
    }
  }

  const visited = new Set<string>()
  const reported = new Set<string>()
  const dfs = (node: string, stack: string[]) => {
    const stackIndex = stack.indexOf(node)
    if (stackIndex !== -1) {
      const cycle = [...stack.slice(stackIndex), node]
      const key = [...cycle].sort().join(',')
      if (!reported.has(key)) {
        reported.add(key)
        addIssue(issues, '/dataflow', `dataflow units form a dependency cycle: ${cycle.join(' -> ')}`, 'remove one dependOn edge to break the cycle — dependOn must form a DAG, and never carries a value reference')
      }
      return
    }
    if (visited.has(node)) return
    visited.add(node)
    for (const dep of deps.get(node) ?? []) dfs(dep, [...stack, node])
    visited.delete(node)
  }
  for (const name of deps.keys()) dfs(name, [])
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
    if (resource.disabled) checkVisibilityScope(resource.disabled, `${path}/disabled`, variableAllow, variableHint, issues)
    for (const name of scanVariableRefs(resource.spec)) {
      if (!variableAllow.includes(name)) addIssue(issues, `${path}/spec`, `variable ${name} is not allowed in this scope`, variableHint())
    }
    for (const name of scanValueRefs(resource.spec)) {
      if (!variableAllow.includes(name)) addIssue(issues, `${path}/spec`, `variable ${name} is not allowed in this scope`, variableHint())
    }
    if (resource.record) {
      for (const name of scanVariableRefs(resource.record)) {
        if (!variableAllow.includes(name)) addIssue(issues, `${path}/record`, `variable ${name} is not allowed in this scope`, variableHint())
      }
    }
    for (const declaration of variableDeclarations(resource)) {
      if (!variableAllow.includes(declaration.name)) {
        addIssue(issues, `${path}/variables`, `variable ${declaration.name} is not allowed in this scope`, variableHint())
      }
    }
  }

  for (const [name, value] of Object.entries(options.variables?.lock ?? {})) {
    for (const declaration of variableDeclarations(resource)) {
      if (declaration.name === name && declaration.default !== undefined && !sameJsonValue(declaration.default, value)) {
        addIssue(
          issues,
          `${path}/variables`,
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

    // A `DataBinding`/`MutationBinding` envelope (`{apiVersion, kind, spec}`)
    // is structurally indistinguishable from the other at this point — both
    // dispatch through a registered manifest by the same key, so a node is
    // valid here if *either* registry recognizes it. `spec.connection`/
    // `spec.datasourceUid` (moved off the envelope in the kind-shape
    // reshape) carry the scope allow-list checks that used to sit directly
    // on the binding.
    if (typeof current.apiVersion === 'string' && typeof current.kind === 'string' && 'spec' in current) {
      const isDataSource = Boolean(registry.getDataSourceManifest(current.apiVersion, current.kind))
      const isMutationSource = Boolean(registry.getMutationSourceManifest(current.apiVersion, current.kind))
      if (!isDataSource && !isMutationSource) {
        const registeredKinds = [...registry.listDataSourceManifests(), ...registry.listMutationSourceManifests()].map((manifest) => manifest.kind)
        addIssue(
          issues,
          `${currentPath}/kind`,
          `no data source or mutation source manifest ${current.apiVersion}/${current.kind} is registered`,
          `register a manifest for "${current.kind}", or use one of: ${registeredKinds.join(', ') || '(none registered)'}`,
        )
      }

      const spec = current.spec
      if (isRecord(spec)) {
        if (current.kind === 'datasource' && options?.datasources?.allow && typeof spec.datasourceUid === 'string' && !options.datasources.allow.includes(spec.datasourceUid)) {
          addIssue(
            issues,
            `${currentPath}/spec/datasourceUid`,
            `datasource ${spec.datasourceUid} is not allowed in this scope`,
            `use one of the scope's allowed datasources: ${options.datasources.allow.join(', ') || '(none allowed)'}`,
          )
        }
        if (current.kind === 'connection' && options?.connections?.allow && typeof spec.connection === 'string' && !options.connections.allow.includes(spec.connection)) {
          addIssue(
            issues,
            `${currentPath}/spec/connection`,
            `connection ${spec.connection} is not allowed in this scope`,
            `use one of the scope's allowed connections: ${options.connections.allow.join(', ') || '(none allowed)'}`,
          )
        }
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
  if (resource.record) visit(resource.record, `${path}/record`)
  if (resource.events) visit(resource.events, `${path}/events`)
  if (resource.dataflow) visit(resource.dataflow, `${path}/dataflow`)
}

/**
 * `$dataflow` refs are resolved off the document-level `DataflowEngine`'s
 * snapshot at render time — a global by-name lookup, never a graph lookup
 * and never gated by render-tree ancestry — so a ref to an undeclared name
 * would silently resolve to `undefined` at render time instead of failing.
 * `declaredNames` is the flat, document-wide set of every declared unit's
 * name, computed once (see `validateResource`), not threaded top-down.
 */
function validateDataflowRefs(resource: Resource, path: string, declaredNames: Set<string>, issues: ValidationIssue[]): void {
  for (const ref of scanDataflowRefs(resource.spec)) {
    if (!declaredNames.has(ref.$dataflow)) {
      addIssue(
        issues,
        `${path}/spec`,
        `referenced dataflow unit ${ref.$dataflow} is not declared anywhere in this document`,
        `declare a dataflow unit named "${ref.$dataflow}" (anywhere in the document — dataflow is document-wide, not tree-bound), or use one of: ${[...declaredNames].join(', ') || '(none declared)'}`,
      )
    }
  }
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
  const dataflowUnits = collectDataflowUnits(resource)
  validateDataflowGraph(dataflowUnits, issues)
  const declaredDataflowNames = new Set(dataflowUnits.map((unit) => unit.name))

  const visit = (current: unknown, path: string, depth: number) => {
    if (!validateEnvelope(current, path, issues)) return
    validateScopedCapabilities(current, options, path, depth, issues)
    validateDataflowRefs(current, path, declaredDataflowNames, issues)
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
      if (manifest.recordScope && current.record === undefined) {
        addIssue(issues, `${path}/record`, `record is required for recordScope kind ${current.kind}`, 'add a record: a DataBinding fetch or a { "$state": "name" } pointer')
      }
    }

    current.slots?.forEach((slot, slotIndex) => {
      children(slot).forEach((child, childIndex) => visit(child, `${path}/slots/${slotIndex}/items/${childIndex}`, depth + 1))
    })
  }

  visit(resource, '', 0)
  return { valid: issues.length === 0, issues }
}

