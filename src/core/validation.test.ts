import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry'
import { staticResolver } from '../dataflow/resolvers'
import { validateResource } from './validation'

const API_VERSION = 'resourcekit.dev/v1alpha1'

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
  registry.use({ name: 'test', kinds: [panel, text], dataSourceManifests: [{ apiVersion: API_VERSION, kind: 'static', resolve: staticResolver }] })
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
        spec: { title: 'Customers', data: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [{ id: '1' }] } } },
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
          data: { apiVersion: API_VERSION, kind: 'datasource', spec: { datasourceUid: 'erp', query: { id: '${accountId}' } } },
        },
        events: { rowSelect: { kind: 'action', action: 'customers.delete' } },
        variables: [{ name: 'tenant', default: 'other' }],
        slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', spec: { text: 'Hidden' } }] }],
      },
      scoped,
    )

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        `no data source or mutation source manifest ${API_VERSION}/datasource is registered`,
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

  it('validates visibility shape and its scoped variable', () => {
    const scoped = registry().scope({ variables: { allow: ['isAdmin'] } })
    expect(
      validateResource(
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', visible: { $variable: 'isAdmin' }, spec: { text: 'Admin' } },
        scoped,
      ),
    ).toEqual({ valid: true, issues: [] })

    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Text',
        visible: { $variable: 'roles', equals: 'admin', contains: 'admin' },
        spec: { text: 'Admin' },
      } as unknown as import('./types').Resource,
      scoped,
    )
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['/visible', '/visible/$variable']))
  })

  it('rejects non-string visibility comparisons', () => {
    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Text',
        visible: { $variable: 'mode', equals: 1 },
        spec: { text: 'Admin' },
      } as unknown as import('./types').Resource,
      registry(),
    )

    expect(result.issues.map((issue) => issue.path)).toContain('/visible/equals')
  })

  it('validates recursive $and/$or/$not visibility conditions, including nested scope violations', () => {
    const scoped = registry().scope({ variables: { allow: ['roles'] } })
    const ok = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Text',
        visible: { $or: [{ $variable: 'roles', contains: 'admin' }, { $variable: 'roles', contains: 'operator' }] },
        spec: { text: 'Admin' },
      },
      scoped,
    )
    expect(ok).toEqual({ valid: true, issues: [] })

    const badShape = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Text',
        visible: { $and: [{ $variable: 'roles', equals: 'admin', contains: 'admin' }] },
        spec: { text: 'Admin' },
      } as unknown as import('./types').Resource,
      scoped,
    )
    expect(badShape.issues.map((issue) => issue.path)).toContain('/visible/$and/0')

    const scopeViolation = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Text',
        visible: { $not: { $variable: 'notAllowed' } },
        spec: { text: 'Admin' },
      },
      scoped,
    )
    expect(scopeViolation.issues.map((issue) => issue.path)).toContain('/visible/$not/$variable')
  })

  it('validates disabled with the same shape and scope rules as visible', () => {
    const scoped = registry().scope({ variables: { allow: ['isAdmin'] } })
    expect(
      validateResource(
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', disabled: { $variable: 'isAdmin' }, spec: { text: 'Admin' } },
        scoped,
      ),
    ).toEqual({ valid: true, issues: [] })

    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Text',
        disabled: { $variable: 'roles', equals: 'admin', contains: 'admin' },
        spec: { text: 'Admin' },
      } as unknown as import('./types').Resource,
      scoped,
    )
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['/disabled', '/disabled/$variable']))

    const scopeViolation = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Text',
        disabled: { $or: [{ $variable: 'notAllowed' }] },
        spec: { text: 'Admin' },
      },
      scoped,
    )
    expect(scopeViolation.issues.map((issue) => issue.path)).toContain('/disabled/$or/0/$variable')
  })

  it('enforces connections.allow on a bare Resource spec.data binding', () => {
    const scoped = registry().scope({ connections: { allow: ['public'] } })

    const disallowed = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 'Customers', data: { apiVersion: API_VERSION, kind: 'connection', spec: { connection: 'secret', request: { path: '/customers' } } } },
      },
      scoped,
    )
    expect(disallowed.issues.map((issue) => issue.message)).toContain('connection secret is not allowed in this scope')

    const allowed = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 'Customers', data: { apiVersion: API_VERSION, kind: 'connection', spec: { connection: 'public', request: { path: '/customers' } } } },
      },
      scoped,
    )
    expect(allowed.issues.map((issue) => issue.message)).not.toContain('connection public is not allowed in this scope')
  })

  it('rejects variables/events placed inside spec even when the kind schema allows additionalProperties', () => {
    // A kind whose own specSchema allows extra properties (a real, common
    // pattern — see e.g. GridKitTable, SelectableList) would otherwise let
    // `spec.variables`/`spec.events` through its own ajv check silently.
    // The runtime only ever reads these from the envelope, so a document
    // that puts them in spec would validate as "valid" while the runtime
    // quietly never sees them — this must fail validation instead.
    const loose = createRegistry()
    loose.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Loose',
          specSchema: { type: 'object', additionalProperties: true, properties: {} },
        },
      ],
    })

    const misplacedVariables = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Loose',
        spec: { variables: [{ name: 'x' }] },
      },
      loose,
    )
    expect(misplacedVariables.valid).toBe(false)
    expect(misplacedVariables.issues.map((issue) => issue.path)).toContain('/spec/variables')

    const misplacedEvents = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Loose',
        spec: { events: { click: { kind: 'internal' } } },
      },
      loose,
    )
    expect(misplacedEvents.valid).toBe(false)
    expect(misplacedEvents.issues.map((issue) => issue.path)).toContain('/spec/events')

    const correct = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Loose',
        spec: {},
        variables: [{ name: 'x' }],
        events: { click: { kind: 'internal' } },
      },
      loose,
    )
    expect(correct.valid).toBe(true)
  })

  it('rejects a missing required slot instead of only checking slots that are present', () => {
    const required = createRegistry()
    required.use({
      name: 'test',
      kinds: [{ ...panel, slotPolicy: { defaultSlot: { min: 1, accepts: ['Text'] } } }],
    })

    const result = validateResource({ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel', spec: { title: 'Empty' } }, required)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.message)).toContain('default slot is required (min 1) but missing')
  })

  it('rejects a duplicate slot declaration instead of silently letting the renderer drop the first one', () => {
    const named = createRegistry()
    named.use({
      name: 'test',
      kinds: [{ ...panel, slotPolicy: { slots: { main: { min: 0, accepts: ['Text'] } } } }],
    })

    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 'Dup' },
        slots: [
          { name: 'main', items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', spec: { text: 'A' } }] },
          { name: 'main', items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', spec: { text: 'B' } }] },
        ],
      },
      named,
    )
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.message)).toContain('slot main is declared more than once')
  })

  it('rejects a recordScope kind with no record', () => {
    const recordScope = createRegistry()
    recordScope.use({ name: 'test', kinds: [{ ...panel, recordScope: true }] })

    const result = validateResource({ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel', spec: { title: 'x' } }, recordScope)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.message)).toContain('record is required for recordScope kind Panel')
  })

  it('rejects a $dataflow ref to an undeclared unit', () => {
    const result = validateResource(
      { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel', spec: { title: 'x', data: { $dataflow: 'rows' } } },
      registry(),
    )
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.message)).toContain('referenced dataflow unit rows is not declared anywhere in this document')
  })

  it('accepts a $dataflow ref to a unit declared in a sibling subtree, not an ancestor', () => {
    const nestablePanel = { ...panel, slotPolicy: { defaultSlot: { min: 0, accepts: ['Panel'] } } }
    const nested = createRegistry()
    nested.use({ name: 'test', kinds: [nestablePanel], dataSourceManifests: [{ apiVersion: API_VERSION, kind: 'static', resolve: staticResolver }] })

    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 'x' },
        dataflow: [{ name: 'rows', binding: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [] } } }],
        slots: [
          {
            items: [
              { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel', spec: { title: 'y', data: { $dataflow: 'rows' } } },
            ],
          },
        ],
      },
      nested,
    )
    expect(result.valid).toBe(true)
  })

  it('rejects a dependOn reference to an undeclared unit', () => {
    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 'x' },
        dataflow: [{ name: 'detail', binding: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [] } }, dependOn: ['missing'] }],
      },
      registry(),
    )
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.message)).toContain('dataflow unit detail depends on undeclared unit missing')
  })

  it('rejects a dependOn cycle', () => {
    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 'x' },
        dataflow: [
          { name: 'a', binding: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [] } }, dependOn: ['b'] },
          { name: 'b', binding: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [] } }, dependOn: ['a'] },
        ],
      },
      registry(),
    )
    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.message.includes('dependency cycle'))).toBe(true)
  })

  it('rejects a duplicate dataflow unit name', () => {
    const result = validateResource(
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Panel',
        spec: { title: 'x' },
        dataflow: [
          { name: 'rows', binding: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [] } } },
          { name: 'rows', binding: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [] } } },
        ],
      },
      registry(),
    )
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.message)).toContain('dataflow unit name rows is declared more than once')
  })
})
