import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry'
import { staticResolver } from './resolvers'
import { validateResource } from './validation'

const panel = {
  apiVersion: 'loykin.dev/v1alpha1',
  kind: 'Panel',
  specSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title'],
    properties: {
      title: { type: 'string' },
      data: { type: 'object' },
      events: { type: 'object' },
      variables: { type: 'array' },
    },
  },
  slotPolicy: {
    defaultSlot: { min: 0, accepts: ['Text'] },
  },
}

const text = {
  apiVersion: 'loykin.dev/v1alpha1',
  kind: 'Text',
  specSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string' } },
  },
}

function registry() {
  const registry = createRegistry()
  registry.use({ name: 'test', kinds: [panel, text], dataResolvers: { static: staticResolver } })
  return registry
}

describe('validateResource', () => {
  it('validates envelope, spec schema, slot policy, recursion, and data resolvers', () => {
    const result = validateResource(
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 'Customers', data: { source: 'static', rows: [{ id: '1' }] } },
        slots: [{ items: [{ apiVersion: 'loykin.dev/v1alpha1', kind: 'Text', spec: { text: 'Hello' } }] }],
      },
      registry(),
    )

    expect(result).toEqual({ valid: true, issues: [] })
  })

  it('reports schema and slot violations', () => {
    const result = validateResource(
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 1 },
        slots: [{ items: [{ apiVersion: 'loykin.dev/v1alpha1', kind: 'Panel', spec: { title: 'Nested' } }] }],
      },
      registry(),
    )

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toContain('/spec/title')
    expect(result.issues.map((issue) => issue.path)).toContain('/slots/0/items/0/kind')
  })

  it('enforces scoped kinds, variables, datasources, actions, and maxDepth', () => {
    const scoped = registry().scope({
      kinds: { include: ['Panel'] },
      variables: { allow: ['customerId'], lock: { tenant: 'acme' } },
      datasources: { allow: ['crm'] },
      actions: { allow: ['customers.open'] },
      maxDepth: 0,
    })

    const result = validateResource(
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'Panel',
        spec: {
          title: 'Customers',
          data: { source: 'datasource', datasourceUid: 'erp', query: { id: '${accountId}' } },
          events: { rowSelect: { kind: 'action', action: 'customers.delete' } },
          variables: [{ name: 'tenant', default: 'other' }],
        },
        slots: [{ items: [{ apiVersion: 'loykin.dev/v1alpha1', kind: 'Text', spec: { text: 'Hidden' } }] }],
      },
      scoped,
    )

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'data resolver datasource is not registered',
        'datasource erp is not allowed in this scope',
        'action customers.delete is not allowed in this scope',
        'variable accountId is not allowed in this scope',
        'variable tenant is not allowed in this scope',
        'locked variable tenant cannot be overridden',
        'resource depth exceeds maxDepth 0',
        'kind loykin.dev/v1alpha1/Text is not registered or not allowed in this scope',
      ]),
    )
  })
})
