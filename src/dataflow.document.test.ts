import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
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
})
