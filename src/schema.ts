import type { JsonSchema } from './types'
import type { ScopedRegistry } from './registry'

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
      }
    }
    if (source === 'rest') {
      return {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'url'],
        properties: {
          source: { const: 'rest' },
          url: { type: 'string' },
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

function cloneSchema(schema: JsonSchema): JsonSchema {
  return structuredClone(schema)
}

function withDataBindingRefs(schema: JsonSchema, hasDataBindingSchema: boolean): JsonSchema {
  const cloned = cloneSchema(schema)
  if (!hasDataBindingSchema) return cloned

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((item) => visit(item))
    if (typeof value !== 'object' || value === null) return value

    const object = value as Record<string, unknown>
    if (typeof object.properties === 'object' && object.properties !== null && !Array.isArray(object.properties)) {
      const properties = object.properties as Record<string, unknown>
      if ('data' in properties) properties.data = { $ref: '#/$defs/dataBinding' }
    }
    for (const [key, item] of Object.entries(object)) {
      object[key] = visit(item)
    }
    return object
  }

  return visit(cloned) as JsonSchema
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

function embedSpecSchema(manifest: { apiVersion: string; kind: string; specSchema: JsonSchema }, hasDataBindingSchema: boolean, defs: Record<string, unknown>): JsonSchema {
  const withBindings = withDataBindingRefs(manifest.specSchema, hasDataBindingSchema)
  return hoistSpecDefs(withBindings, definitionKey(manifest.apiVersion, manifest.kind), defs)
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
  const dataSchemas = dataBindingSchemas(scoped.listDataResolvers())
  const hasDataBindingSchema = dataSchemas.length > 0
  const definitions: Record<string, unknown> = {}

  const resourceRefForKind = (kind: string): JsonSchema[] =>
    manifests
      .filter((manifest) => manifest.kind === kind)
      .map((manifest) => ({ $ref: `#/$defs/${definitionKey(manifest.apiVersion, manifest.kind)}` }))

  const resourceItemsForAccepts = (accepts?: string[]): JsonSchema => {
    if (!accepts || accepts.length === 0) return { $ref: '#/$defs/resource' }
    const refs = accepts.flatMap((kind) => resourceRefForKind(kind))
    return refs.length === 1 ? refs[0] : { oneOf: refs }
  }

  const slotItemSchema = (name: string | undefined, accepts?: string[], min?: number, max?: number): JsonSchema => {
    const properties: Record<string, unknown> = {
      items: {
        type: 'array',
        items: resourceItemsForAccepts(accepts),
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

    return {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties,
    }
  }

  for (const manifest of manifests) {
    const properties: Record<string, unknown> = {
      apiVersion: { const: manifest.apiVersion },
      kind: { const: manifest.kind },
      metadata: metadataSchema,
      spec: embedSpecSchema(manifest, hasDataBindingSchema, definitions),
    }
    const required = ['apiVersion', 'kind', 'spec']

    if (manifest.slotPolicy) {
      const slotBranches: JsonSchema[] = []
      if (manifest.slotPolicy.defaultSlot) {
        const rule = manifest.slotPolicy.defaultSlot
        slotBranches.push(slotItemSchema(undefined, rule.accepts, rule.min, rule.max))
      }
      for (const [name, rule] of Object.entries(manifest.slotPolicy.slots ?? {})) {
        slotBranches.push(slotItemSchema(name, rule.accepts, rule.min, rule.max))
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
    }
  }

  definitions.resource =
    manifests.length === 0
      ? false
      : { oneOf: manifests.map((manifest) => ({ $ref: `#/$defs/${definitionKey(manifest.apiVersion, manifest.kind)}` })) }

  if (hasDataBindingSchema) {
    definitions.dataBinding = dataSchemas.length === 1 ? dataSchemas[0] : { oneOf: dataSchemas }
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $ref: '#/$defs/resource',
    $defs: definitions,
  }
}
