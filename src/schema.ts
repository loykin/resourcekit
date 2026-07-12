import type { JsonSchema, KindManifest, SlotRule, StageBatchPosition, StageBatchResult, StagePosition, StageResult } from './types'
import type { ScopedRegistry } from './registry'

const DEFAULT_SLOT_KEY = '(default)'
const SLOT_ITEM_CAP = 20

const metadataSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    labels: { type: 'object', additionalProperties: { type: 'string' } },
    annotations: { type: 'object', additionalProperties: { type: 'string' } },
  },
}

function definitionKey(apiVersion: string, kind: string): string {
  return `${apiVersion.replace(/[^A-Za-z0-9_]/g, '_')}__${kind.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function dataBindingSchemas(sources: string[]): JsonSchema[] {
  return sources.map((source) => {
    if (source === 'static') {
      return {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'rows'],
        properties: {
          source: { const: 'static' },
          rows: { type: 'array', items: { type: 'object' } },
        },
        description: 'Rows are fixed, inline data — cannot be filtered by a variable. For a RecordScope driven by a selection, use rest/datasource instead so the binding can be parameterized with `${variable}`.',
      }
    }
    if (source === 'rest') {
      return {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'url'],
        properties: {
          source: { const: 'rest' },
          url: { type: 'string', description: 'May reference a page variable via `${variableName}`, e.g. "/api/users/${selectedId}".' },
          method: { enum: ['GET', 'POST'] },
          body: {},
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          rowsPath: { type: 'string' },
        },
      }
    }
    return {
      type: 'object',
      required: ['source'],
      properties: {
        source: { const: source },
      },
    }
  })
}

function mutationBindingSchemas(targets: string[]): JsonSchema[] {
  return targets.map((target) => {
    if (target === 'rest') {
      return {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'url'],
        properties: {
          target: { const: 'rest' },
          url: { type: 'string', description: 'May reference a page variable via `${variableName}`.' },
          method: { enum: ['POST', 'PUT', 'PATCH', 'DELETE'] },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
        },
      }
    }
    if (target === 'datasource') {
      return {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'datasourceUid'],
        properties: {
          target: { const: 'datasource' },
          datasourceUid: { type: 'string' },
          mutation: {},
        },
      }
    }
    return {
      type: 'object',
      required: ['target'],
      properties: {
        target: { const: target },
      },
    }
  })
}

/** `BehaviorPolicy.events` — one policy per event name a kind actually emits (e.g. "click", "select", "rowSelect"; see the kind's own description). */
const eventPolicySchema: JsonSchema = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'internal' } } },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'event'],
      properties: { kind: { const: 'emit' }, event: { type: 'string', description: 'Surfaced to the host app via ResourceRenderer onEvent.' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'action'],
      properties: { kind: { const: 'action' }, action: { type: 'string', description: 'Must be in the scope\'s allowed actions list.' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'variable'],
      properties: {
        kind: { const: 'setVariable' },
        variable: { type: 'string' },
        from: { type: 'string', description: 'Dot-path into the event payload, e.g. "row.id" for a row-select event.' },
      },
    },
  ],
}

/** One entry of a kind's `variables` array — declares a page variable the document can read/write via `${name}`/`variables.<name>`. */
const variableDeclarationSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string' },
    type: { enum: ['string', 'string[]'] },
    default: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    persist: { enum: ['url', 'none'], description: '"url" syncs to a query param; omit or "none" for transient UI state.' },
  },
}

function cloneSchema(schema: JsonSchema): JsonSchema {
  return structuredClone(schema)
}

interface WellKnownRefOptions {
  hasDataBindingSchema: boolean
  hasMutationBindingSchema: boolean
}

/**
 * Rewrites well-known, generically-shaped spec properties (`data`, `mutation`,
 * `events`, `variables`) into refs against the shared `$defs` schemas built
 * from the scope's registered resolvers and the core `EventPolicy`/
 * `VariableDeclaration` types, instead of the bare `specSchema` a kind
 * manifest ships (which can't know the scope's resolvers or repeat the
 * runtime's own types by hand). `events`/`variables` are always rewritten —
 * their shape doesn't depend on scope state.
 */
function withWellKnownRefs(schema: JsonSchema, options: WellKnownRefOptions): JsonSchema {
  const cloned = cloneSchema(schema)

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((item) => visit(item))
    if (typeof value !== 'object' || value === null) return value

    const object = value as Record<string, unknown>
    if (typeof object.properties === 'object' && object.properties !== null && !Array.isArray(object.properties)) {
      const properties = object.properties as Record<string, unknown>
      if (options.hasDataBindingSchema && 'data' in properties) properties.data = { $ref: '#/$defs/dataBinding' }
      if (options.hasMutationBindingSchema && 'mutation' in properties) properties.mutation = { $ref: '#/$defs/mutationBinding' }
      if ('events' in properties) properties.events = { type: 'object', additionalProperties: { $ref: '#/$defs/eventPolicy' } }
      if ('variables' in properties) properties.variables = { type: 'array', items: { $ref: '#/$defs/variableDeclaration' } }
    }
    for (const [key, item] of Object.entries(object)) {
      object[key] = visit(item)
    }
    return object
  }

  return visit(cloned) as JsonSchema
}

/** Adds the always-available `eventPolicy`/`variableDeclaration` defs, plus `dataBinding`/`mutationBinding` when the scope has registered resolvers for them. */
function addWellKnownDefs(defs: Record<string, unknown>, scoped: ScopedRegistry): WellKnownRefOptions {
  defs.eventPolicy = eventPolicySchema
  defs.variableDeclaration = variableDeclarationSchema

  const dataSchemas = dataBindingSchemas(scoped.listDataResolvers())
  const hasDataBindingSchema = dataSchemas.length > 0
  if (hasDataBindingSchema) defs.dataBinding = dataSchemas.length === 1 ? dataSchemas[0] : { oneOf: dataSchemas }

  const mutationSchemas = mutationBindingSchemas(scoped.listMutationResolvers())
  const hasMutationBindingSchema = mutationSchemas.length > 0
  if (hasMutationBindingSchema) defs.mutationBinding = mutationSchemas.length === 1 ? mutationSchemas[0] : { oneOf: mutationSchemas }

  return { hasDataBindingSchema, hasMutationBindingSchema }
}

/** Manifests matching `accepts` (by kind name) or `acceptsLevels` (by level intersection), deduped. Unset both to accept everything. */
function resolveCandidates(manifests: KindManifest[], accepts?: string[], acceptsLevels?: string[]): KindManifest[] {
  if ((!accepts || accepts.length === 0) && (!acceptsLevels || acceptsLevels.length === 0)) return manifests
  const acceptedNames = new Set(accepts ?? [])
  const seen = new Set<KindManifest>()
  const result: KindManifest[] = []
  for (const manifest of manifests) {
    if (seen.has(manifest)) continue
    const matches = acceptedNames.has(manifest.kind) || (acceptsLevels?.some((level) => manifest.level?.includes(level)) ?? false)
    if (matches) {
      seen.add(manifest)
      result.push(manifest)
    }
  }
  return result
}

/** Envelope + spec schema for one kind, deliberately without `slots` — used by `nextStage` where children are resolved by a later call. */
function nodeEnvelopeSchema(manifest: KindManifest, refOptions: WellKnownRefOptions, defs: Record<string, unknown>): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['apiVersion', 'kind', 'spec'],
    properties: {
      apiVersion: { const: manifest.apiVersion },
      kind: { const: manifest.kind },
      metadata: metadataSchema,
      spec: embedSpecSchema(manifest, refOptions, defs),
    },
    ...(manifest.description ? { description: manifest.description } : {}),
  }
}

/** Envelope-only schema for one kind (`apiVersion`/`kind`, no `spec`) — used by `nextStageBatch`'s arrangement phase, where only the kind choice is being made. */
function arrangementSchema(manifest: KindManifest): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['apiVersion', 'kind'],
    properties: {
      apiVersion: { const: manifest.apiVersion },
      kind: { const: manifest.kind },
    },
    ...(manifest.description ? { description: manifest.description } : {}),
  }
}

/**
 * A kind's own `specSchema` may ship its own `$defs` (e.g. an adapter that embeds a
 * kit's own JSON Schema verbatim, refs and all — see chartkit's `ChartSpec`). Once that
 * schema is nested inside the composed document, plain `#/$defs/X` refs would resolve
 * against the *document's* root `$defs`, not the nested one — so lift each entry into
 * the document's shared `defs` map under a namespaced key and rewrite the refs to match.
 */
function hoistSpecDefs(schema: JsonSchema, namespace: string, defs: Record<string, unknown>): JsonSchema {
  const nested = schema.$defs
  if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return schema

  const rewriteRefs = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((item) => rewriteRefs(item))
    if (typeof value !== 'object' || value === null) return value

    const object = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(object)) {
      result[key] = key === '$ref' && typeof item === 'string' && item.startsWith('#/$defs/')
        ? `#/$defs/${namespace}__${item.slice('#/$defs/'.length)}`
        : rewriteRefs(item)
    }
    return result
  }

  const rewritten = rewriteRefs(schema) as Record<string, unknown>
  const rewrittenNested = rewritten.$defs as Record<string, unknown>
  delete rewritten.$defs
  for (const [name, def] of Object.entries(rewrittenNested)) {
    defs[`${namespace}__${name}`] = def
  }
  return rewritten as JsonSchema
}

function embedSpecSchema(manifest: { apiVersion: string; kind: string; specSchema: JsonSchema }, refOptions: WellKnownRefOptions, defs: Record<string, unknown>): JsonSchema {
  const withRefs = withWellKnownRefs(manifest.specSchema, refOptions)
  return hoistSpecDefs(withRefs, definitionKey(manifest.apiVersion, manifest.kind), defs)
}

/**
 * Generate the composed JSON Schema for a scoped registry. This is the schema
 * handed to MCP / AI structured output — never expose the full registry.
 *
 * Composition rules (see "Data Bindings" and "Scoped Capabilities" in the spec):
 * - One discriminated `oneOf` branch per registered kind (envelope + specSchema).
 * - Recursive slot/children references constrained by each kind's slot policy.
 * - `spec.data` composes only the registered data resolvers' binding schemas.
 * - Leaf kinds (no slot policy) must not admit `slots` (additionalProperties: false).
 * - Scope pick/omit/lock is applied to spec schemas before composition.
 */
export function buildDocumentSchema(scoped: ScopedRegistry): JsonSchema {
  const manifests = scoped.listKinds()
  const definitions: Record<string, unknown> = {}
  const refOptions = addWellKnownDefs(definitions, scoped)

  // Most slots resolve to the same handful of (accepts, acceptsLevels) combinations
  // (e.g. every content slot is `acceptsLevels: ['organism', 'leaf']`). Inlining the
  // resolved oneOf at every slot repeats the same ~N-kind list dozens of times across
  // a real registry — a $ref to one shared $defs entry per distinct combination keeps
  // the schema the AI reads a fraction of the size for identical constraints.
  const sharedAcceptsDefs = new Map<string, { key: string; refs: JsonSchema[] }>()

  const resourceItemsForAccepts = (accepts?: string[], acceptsLevels?: string[]): JsonSchema => {
    if ((!accepts || accepts.length === 0) && (!acceptsLevels || acceptsLevels.length === 0)) {
      return { $ref: '#/$defs/resource' }
    }
    const refs = resolveCandidates(manifests, accepts, acceptsLevels).map((manifest) => ({
      $ref: `#/$defs/${definitionKey(manifest.apiVersion, manifest.kind)}`,
    }))
    if (refs.length <= 1) return refs[0] ?? { not: {} }

    const cacheKey = JSON.stringify([[...(accepts ?? [])].sort(), [...(acceptsLevels ?? [])].sort()])
    if (!sharedAcceptsDefs.has(cacheKey)) {
      sharedAcceptsDefs.set(cacheKey, { key: `accepts__${sharedAcceptsDefs.size}`, refs })
    }
    return { $ref: `#/$defs/${sharedAcceptsDefs.get(cacheKey)!.key}` }
  }

  const slotItemSchema = (
    name: string | undefined,
    accepts?: string[],
    acceptsLevels?: string[],
    min?: number,
    max?: number,
    description?: string,
  ): JsonSchema => {
    const properties: Record<string, unknown> = {
      items: {
        type: 'array',
        items: resourceItemsForAccepts(accepts, acceptsLevels),
      },
    }
    if (name === undefined) {
      properties.name = false
    } else {
      properties.name = { const: name }
    }
    const itemsProp = properties.items as Record<string, unknown>
    if (min !== undefined) itemsProp.minItems = min
    if (max !== undefined) itemsProp.maxItems = max

    const schema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties,
    }
    if (description) schema.description = description
    return schema
  }

  for (const manifest of manifests) {
    const properties: Record<string, unknown> = {
      apiVersion: { const: manifest.apiVersion },
      kind: { const: manifest.kind },
      metadata: metadataSchema,
      spec: embedSpecSchema(manifest, refOptions, definitions),
    }
    const required = ['apiVersion', 'kind', 'spec']

    if (manifest.slotPolicy) {
      const slotBranches: JsonSchema[] = []
      if (manifest.slotPolicy.defaultSlot) {
        const rule = manifest.slotPolicy.defaultSlot
        slotBranches.push(slotItemSchema(undefined, rule.accepts, rule.acceptsLevels, rule.min, rule.max, rule.description))
      }
      for (const [name, rule] of Object.entries(manifest.slotPolicy.slots ?? {})) {
        slotBranches.push(slotItemSchema(name, rule.accepts, rule.acceptsLevels, rule.min, rule.max, rule.description))
      }
      if (slotBranches.length > 0) {
        properties.slots = {
          type: 'array',
          items: slotBranches.length === 1 ? slotBranches[0] : { oneOf: slotBranches },
        }
      }
    }

    definitions[definitionKey(manifest.apiVersion, manifest.kind)] = {
      type: 'object',
      additionalProperties: false,
      required,
      properties,
      ...(manifest.description ? { description: manifest.description } : {}),
    }
  }

  const rootLevels = scoped.options.rootLevels
  const rootManifests = rootLevels ? manifests.filter((manifest) => manifest.level?.some((level) => rootLevels.includes(level))) : manifests

  definitions.resource =
    rootManifests.length === 0
      ? false
      : { oneOf: rootManifests.map((manifest) => ({ $ref: `#/$defs/${definitionKey(manifest.apiVersion, manifest.kind)}` })) }

  for (const { key, refs } of sharedAcceptsDefs.values()) {
    definitions[key] = { oneOf: refs }
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $ref: '#/$defs/resource',
    $defs: definitions,
  }
}

/**
 * Resolve one position in the document tree without expanding the rest of
 * it — a stateless "given what's already chosen, what's valid next" primitive.
 * Candidate resolution is shared with `buildDocumentSchema`, so this can't
 * drift from one-shot semantics. Intended to be called directly by whatever
 * is orchestrating generation (an MCP client's own tool-calling loop, a host
 * application's own generation loop, etc.) — see
 * docs/staged-generation-experiment.md for why resourcekit doesn't ship a
 * pre-built orchestration loop of its own: the caller is already an agent
 * capable of deciding when and how many times to call this.
 *
 * Candidates are the root-eligible kinds (`ScopeOptions.rootLevels`,
 * unrestricted if unset) when `position.parent` is omitted, or whatever the
 * parent kind's named/default slot accepts otherwise.
 *
 * A single candidate is returned as `fixed` — there is no real choice, so
 * the host can insert it without an AI turn. Multiple candidates return a
 * self-contained `schema` (own `$defs`) covering just their envelope + spec,
 * not their slots; call `nextStage` again once a kind is chosen to resolve
 * its children.
 */
export function nextStage(scoped: ScopedRegistry, position: StagePosition): StageResult {
  const manifests = scoped.listKinds()

  let candidates: KindManifest[]
  if (!position.parent) {
    const rootLevels = scoped.options.rootLevels
    candidates = rootLevels ? manifests.filter((manifest) => manifest.level?.some((level) => rootLevels.includes(level))) : manifests
  } else {
    const { apiVersion, kind, slotName } = position.parent
    const parentManifest = scoped.getKind(apiVersion, kind)
    if (!parentManifest) throw new Error(`nextStage: unknown parent kind ${apiVersion}/${kind}`)
    const rule = slotName === undefined ? parentManifest.slotPolicy?.defaultSlot : parentManifest.slotPolicy?.slots?.[slotName]
    if (!rule) throw new Error(`nextStage: kind ${kind} has no slot ${slotName ?? '(default)'}`)
    candidates = resolveCandidates(manifests, rule.accepts, rule.acceptsLevels)
  }

  if (candidates.length === 0) return { schema: { oneOf: [] } }

  if (candidates.length === 1) {
    const only = candidates[0]
    return { fixed: { apiVersion: only.apiVersion, kind: only.kind } }
  }

  const definitions: Record<string, unknown> = {}
  const refOptions = addWellKnownDefs(definitions, scoped)
  for (const manifest of candidates) {
    definitions[definitionKey(manifest.apiVersion, manifest.kind)] = nodeEnvelopeSchema(manifest, refOptions, definitions)
  }

  return {
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      oneOf: candidates.map((manifest) => ({ $ref: `#/$defs/${definitionKey(manifest.apiVersion, manifest.kind)}` })),
      $defs: definitions,
    },
  }
}

/**
 * Resolve every slot on an already-known parent kind at once, instead of one
 * `nextStage` call per slot name — lets a caller batch a whole wave of
 * sibling decisions into a single request. Built on the same
 * candidate-resolution logic as `nextStage`/`buildDocumentSchema`, so it
 * can't drift from their semantics. See docs/staged-generation-experiment.md
 * for the batching rationale and measurements.
 *
 * A slot is "repeatable" when its `SlotRule.max` is unset or greater than 1
 * — even with a single candidate kind, the count is still a real decision,
 * so it always goes into `.schema` as an array. A non-repeatable slot
 * (`max === 1`) with exactly one candidate is `fixed`; with zero or two-plus
 * candidates it goes into `.schema`. Optional slots (`min` 0 or unset) are
 * left out of `.schema`'s `required` — omitting the key means declining
 * that slot.
 */
export function nextStageBatch(scoped: ScopedRegistry, position: StageBatchPosition): StageBatchResult {
  const { apiVersion, kind } = position.parent
  const parentManifest = scoped.getKind(apiVersion, kind)
  if (!parentManifest) throw new Error(`nextStageBatch: unknown parent kind ${apiVersion}/${kind}`)
  if (!parentManifest.slotPolicy) return { fixed: {} }

  const manifests = scoped.listKinds()
  const fixed: Record<string, { apiVersion: string; kind: string }> = {}
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  const defs: Record<string, JsonSchema> = {}

  const refFor = (manifest: KindManifest): JsonSchema => {
    const key = definitionKey(manifest.apiVersion, manifest.kind)
    if (!defs[key]) defs[key] = arrangementSchema(manifest)
    return { $ref: `#/$defs/${key}` }
  }

  const slotEntries: [string, SlotRule][] = []
  if (parentManifest.slotPolicy.defaultSlot) slotEntries.push([DEFAULT_SLOT_KEY, parentManifest.slotPolicy.defaultSlot])
  for (const [name, rule] of Object.entries(parentManifest.slotPolicy.slots ?? {})) slotEntries.push([name, rule])

  for (const [slotName, rule] of slotEntries) {
    const candidates = resolveCandidates(manifests, rule.accepts, rule.acceptsLevels)
    const isRequired = (rule.min ?? 0) >= 1
    const isRepeatable = rule.max === undefined || rule.max > 1

    if (!isRepeatable) {
      // Only truly call-free when the slot is both deterministic (one candidate) and
      // mandatory (min >= 1) — an optional single-candidate slot still needs an
      // inclusion decision, so it stays in `.schema` as a one-option `oneOf`.
      if (candidates.length === 1 && isRequired) {
        fixed[slotName] = { apiVersion: candidates[0].apiVersion, kind: candidates[0].kind }
        continue
      }
      properties[slotName] = { oneOf: candidates.map(refFor), ...(rule.description ? { description: rule.description } : {}) }
      if (isRequired) required.push(slotName)
      continue
    }

    const minItems = rule.min ?? 0
    const maxItems = Math.min(rule.max ?? SLOT_ITEM_CAP, SLOT_ITEM_CAP)
    properties[slotName] = {
      type: 'array',
      items: { oneOf: candidates.map(refFor) },
      minItems,
      maxItems,
      ...(rule.description ? { description: rule.description } : {}),
    }
    if (isRequired) required.push(slotName)
  }

  if (Object.keys(properties).length === 0) return { fixed }

  return {
    fixed,
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required,
      properties,
      ...(Object.keys(defs).length > 0 ? { $defs: defs } : {}),
    },
  }
}

/**
 * Envelope + spec schema for one already-known kind — no kind choice, just
 * filling `spec`. Useful once a caller has resolved a position to `fixed`
 * (via `nextStage`/`nextStageBatch`) but the kind's own spec still has real
 * content to fill (there is exactly one candidate here by construction, so
 * no `oneOf` is needed). Returns `undefined` if the kind isn't registered in
 * this scope.
 */
export function singleKindSchema(scoped: ScopedRegistry, apiVersion: string, kind: string): JsonSchema | undefined {
  const manifest = scoped.getKind(apiVersion, kind)
  if (!manifest) return undefined

  const defs: Record<string, unknown> = {}
  const refOptions = addWellKnownDefs(defs, scoped)
  const node = nodeEnvelopeSchema(manifest, refOptions, defs)

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...node,
    ...(Object.keys(defs).length > 0 ? { $defs: defs } : {}),
  }
}
