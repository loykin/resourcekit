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
      children: {
        type: 'array',
        items: resourceItemsForAccepts(accepts),
      },
    }
    if (name === undefined) {
      properties.name = false
    } else {
      properties.name = { const: name }
    }
    const children = properties.children as Record<string, unknown>
    if (min !== undefined) children.minItems = min
    if (max !== undefined) children.maxItems = max

    return {
      type: 'object',
      additionalProperties: false,
      required: ['children'],
      properties,
    }
  }

  for (const manifest of manifests) {
    const properties: Record<string, unknown> = {
      apiVersion: { const: manifest.apiVersion },
      kind: { const: manifest.kind },
      metadata: metadataSchema,
      spec: withDataBindingRefs(manifest.specSchema, hasDataBindingSchema),
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
