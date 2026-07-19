import type { JsonSchema } from '../../types'

export const confirmSpecSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
  },
}

export const submitSpecSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mutation'],
  properties: {
    action: { type: 'string' },
    mutation: { type: 'object' },
    confirm: confirmSpecSchema,
    onSuccess: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'variable'],
            properties: {
              kind: { const: 'setVariable' },
              variable: { type: 'string' },
              from: { type: 'string' },
              value: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'event'],
            properties: { kind: { const: 'emit' }, event: { type: 'string' } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'node'],
            properties: { kind: { const: 'setData' }, node: { type: 'string' }, from: { type: 'string' }, value: {} },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'nodes'],
            properties: { kind: { const: 'invalidateData' }, nodes: { type: 'array', items: { type: 'string' } } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'nodes'],
            properties: { kind: { const: 'refetchData' }, nodes: { type: 'array', items: { type: 'string' } } },
          },
        ],
      },
    },
  },
}
