import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry'
import { staticResolver } from './resolvers'
import { validateResource } from './validation'

const panel = {
  apiVersion: 'resourcekit.dev/v1alpha1',
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
  apiVersion: 'resourcekit.dev/v1alpha1',
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

const page = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'Page',
  level: ['template'],
  specSchema: { type: 'object', properties: {} },
  slotPolicy: { defaultSlot: { min: 0, acceptsLevels: ['organism', 'leaf'] } },
}

const organismPanel = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'OrganismPanel',
  level: ['organism'],
  specSchema: { type: 'object', properties: {} },
}

function levelRegistry() {
  const registry = createRegistry()
  registry.use({ name: 'test', kinds: [page, organismPanel] })
  return registry
}

describe('validateResource', () => {
  it('validates envelope, spec schema, slot policy, recursion, and data resolvers', () => {
    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 'Customers', data: { source: 'static', rows: [{ id: '1' }] } },
        slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', spec: { text: 'Hello' } }] }],
      },
      registry(),
    )

    expect(result).toEqual({ valid: true, issues: [] })
  })

  it('reports schema and slot violations', () => {
    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 1 },
        slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel', spec: { title: 'Nested' } }] }],
      },
      registry(),
    )

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toContain('/spec/title')
    expect(result.issues.map((issue) => issue.path)).toContain('/slots/0/items/0/kind')
  })

  it('gives every issue a path, a message, and an actionable hint (human-editing-and-persistence.md #2)', () => {
    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 1 },
        slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel', spec: { title: 'Nested' } }] }],
      },
      registry(),
    )

    expect(result.valid).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
    for (const issue of result.issues) {
      expect(issue.path).toEqual(expect.any(String))
      expect(issue.message).toEqual(expect.any(String))
      expect(issue.hint, `issue at ${issue.path} ("${issue.message}") is missing a hint`).toEqual(expect.any(String))
    }

    const slotIssue = result.issues.find((issue) => issue.path === '/slots/0/items/0/kind')
    expect(slotIssue?.hint).toContain('Text')
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
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Panel',
        spec: {
          title: 'Customers',
          data: { source: 'datasource', datasourceUid: 'erp', query: { id: '${accountId}' } },
          events: { rowSelect: { kind: 'action', action: 'customers.delete' } },
          variables: [{ name: 'tenant', default: 'other' }],
        },
        slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', spec: { text: 'Hidden' } }] }],
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
        'kind resourcekit.dev/v1alpha1/Text is not registered or not allowed in this scope',
      ]),
    )
  })

  it('rejects a document root whose level does not match a scope rootLevels restriction', () => {
    const scoped = levelRegistry().scope({ rootLevels: ['template'] })

    const okResult = validateResource({ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Page', spec: {} }, scoped)
    expect(okResult.valid).toBe(true)

    const badResult = validateResource({ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'OrganismPanel', spec: {} }, scoped)
    expect(badResult.valid).toBe(false)
    expect(badResult.issues.map((issue) => issue.message)).toContain('kind OrganismPanel is not an allowed root level')
  })

  it('rejects a slot child whose level does not match acceptsLevels, even nested', () => {
    const scoped = levelRegistry().scope({})

    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Page',
        spec: {},
        slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Page', spec: {} }] }],
      },
      scoped,
    )

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.message)).toContain('kind Page is not accepted by this slot')

    const acceptedResult = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Page',
        spec: {},
        slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'OrganismPanel', spec: {} }] }],
      },
      scoped,
    )

    expect(acceptedResult.valid).toBe(true)
  })
})
