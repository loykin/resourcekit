import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import { createDesignKitPlugin } from './adapters'
import type { ResourceDocument } from './dataflow'
import { createRegistry } from './registry'
import { buildResourceDocumentSchema } from './schema'
import { validateResourceDocument } from './validation'

function setup() {
  const registry = createRegistry()
  registry.use({
    name: 'test',
    dataResolvers: { metrics: async () => [] },
    kinds: [
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Table',
        level: ['template'],
        bindingPolicy: { inputs: { selected: { description: 'Selected ID', writable: true } } },
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: { data: { type: 'object' }, events: { type: 'object' } },
        },
      },
    ],
  })
  return registry
}

describe('ResourceDocument authoring', () => {
  it('builds a scoped schema that accepts state, resolve, inline refs and setData', () => {
    const registry = setup()
    const schema = buildResourceDocumentSchema(registry.scope({ rootLevels: ['template'] }))
    const validate = new Ajv2020({ strict: false }).compile(schema)
    const document = {
      data: {
        nodes: {
          selected: { kind: 'state', initialValue: 'a' },
          rows: {
            kind: 'resolve',
            binding: { source: 'metrics', request: { selected: { $data: 'selected' } } },
          },
        },
      },
      resource: {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Table',
        bindings: { selected: { $data: 'selected' } },
        spec: {
          data: { $data: 'rows' },
          events: { rowSelect: { kind: 'setData', node: 'selected', from: 'row.id' } },
        },
      },
    }

    expect(validate(document), validate.errors?.map((error) => error.message).join(', ')).toBe(true)
    expect(JSON.stringify(schema)).not.toContain('transform')
  })

  it('validates graph references, resolver scope and writable setData targets', () => {
    const registry = setup()
    const document: ResourceDocument = {
      data: {
        nodes: {
          rows: { kind: 'resolve', binding: { source: 'missing', request: { selected: { $data: 'absent' } } } },
        },
      },
      resource: {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Table',
        bindings: { selected: { $data: 'rows' } },
        spec: {
          data: { $data: 'alsoAbsent' },
          events: { rowSelect: { kind: 'setData', node: 'rows' } },
        },
      },
    }

    const result = validateResourceDocument(document, registry)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('absent does not exist'),
        expect.stringContaining('resolver missing is not registered'),
        expect.stringContaining('alsoAbsent does not exist'),
        expect.stringContaining('rows is not writable state'),
        expect.stringContaining('writable binding selected must reference a state node'),
      ]),
    )
  })

  it('constrains $data to an enum of knownNodeIds when given (generation-quality.md hallucination surface (b))', () => {
    const registry = setup()
    const scoped = registry.scope({ rootLevels: ['template'] })
    const schema = buildResourceDocumentSchema(scoped, { knownNodeIds: ['selected', 'rows'] })
    const validate = new Ajv2020({ strict: false }).compile(schema)

    const withKnownRef = {
      resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Table', bindings: { selected: { $data: 'rows' } }, spec: { data: { $data: 'selected' } } },
    }
    expect(validate(withKnownRef), validate.errors?.map((error) => error.message).join(', ')).toBe(true)

    const withMadeUpRef = {
      resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Table', bindings: { selected: { $data: 'rows' } }, spec: { data: { $data: 'inventedNodeId' } } },
    }
    expect(validate(withMadeUpRef)).toBe(false)
  })

  it('leaves $data as a free string when knownNodeIds is omitted', () => {
    const registry = setup()
    const scoped = registry.scope({ rootLevels: ['template'] })
    const schema = buildResourceDocumentSchema(scoped)
    const validate = new Ajv2020({ strict: false }).compile(schema)

    const document = {
      resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Table', spec: { data: { $data: 'anythingGoes' } } },
    }
    expect(validate(document), validate.errors?.map((error) => error.message).join(', ')).toBe(true)
  })

  it('rejects every $data reference when knownNodeIds is explicitly empty', () => {
    const registry = setup()
    const schema = buildResourceDocumentSchema(registry.scope({ rootLevels: ['template'] }), { knownNodeIds: [] })
    const validate = new Ajv2020({ strict: false }).compile(schema)

    const document = {
      resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Table', spec: { data: { $data: 'invented' } } },
    }

    expect(validate(document)).toBe(false)
  })

  it('accepts query policy and mutation data effects through scoped schema and runtime validation', () => {
    const registry = createRegistry()
    registry.use(createDesignKitPlugin())
    registry.use({
      name: 'runtime',
      dataResolvers: { metrics: async () => [] },
      mutationResolvers: { memory: async () => ({ id: 'saved' }) },
    })
    const scoped = registry.scope({ kinds: { include: ['FormView'] }, rootLevels: ['template'] })
    const schema = buildResourceDocumentSchema(scoped, { knownNodeIds: ['selected', 'rows'] })
    const validate = new Ajv2020({ strict: false }).compile(schema)
    const document: ResourceDocument = {
      data: {
        nodes: {
          selected: { kind: 'state' },
          rows: {
            kind: 'resolve',
            binding: { source: 'metrics' },
            policy: {
              refresh: { kind: 'interval', ms: 5000 },
              staleForMs: 1000,
              retainPreviousData: true,
              retry: { maxAttempts: 2 },
            },
          },
        },
      },
      resource: {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'FormView',
        spec: {
          sections: [],
          submit: {
            mutation: { target: 'memory' },
            onSuccess: [
              { kind: 'setData', node: 'selected', from: 'id' },
              { kind: 'invalidateData', nodes: ['rows'] },
              { kind: 'refetchData', nodes: ['rows'] },
            ],
          },
        },
      },
    }

    expect(validate(document), validate.errors?.map((error) => `${error.instancePath} ${error.message}`).join(', ')).toBe(true)
    expect(validateResourceDocument(document, scoped)).toEqual({ valid: true, issues: [] })
  })

  it('rejects invalidate/refetch effects that target state or missing nodes', () => {
    const registry = setup()
    const document: ResourceDocument = {
      data: { nodes: { selected: { kind: 'state' } } },
      resource: {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Table',
        spec: {
          data: {},
          events: {
            saved: { kind: 'invalidateData', nodes: ['selected'] },
            refreshed: { kind: 'refetchData', nodes: ['missing'] },
          },
        },
      },
    }

    const result = validateResourceDocument(document, registry)
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['/resource/spec/events/saved/nodes/0', '/resource/spec/events/refreshed/nodes/0']),
    )
  })
})
