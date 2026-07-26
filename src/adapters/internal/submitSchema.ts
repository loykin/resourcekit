import type { JsonSchema } from '../../core/types'

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
            required: ['kind', 'dataflow'],
            properties: { kind: { const: 'invalidateData' }, dataflow: { type: 'array', items: { type: 'string' } } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'dataflow'],
            properties: { kind: { const: 'refetchData' }, dataflow: { type: 'array', items: { type: 'string' } } },
          },
        ],
      },
    },
  },
}
