import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import { createChartKitPlugin } from './adapters'
import { createRegistry } from './registry'
import { restResolver, staticResolver } from './resolvers'
import { buildDocumentSchema, nextStage, nextStageBatch } from './schema'
import type { JsonSchema, Resource } from './types'
import { validateResource } from './validation'

describe('buildDocumentSchema', () => {
  it('builds a scoped recursive schema from registered manifests and resolvers', () => {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          specSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              pageSize: { type: 'number' },
              secret: { type: 'string' },
              data: { type: 'object' },
            },
          },
          slotPolicy: { defaultSlot: { min: 0, accepts: ['Text'] } },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Text',
          specSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Login',
          specSchema: { type: 'object' },
        },
      ],
      dataResolvers: { static: staticResolver, rest: restResolver },
    })

    const schema = buildDocumentSchema(
      registry.scope({
        kinds: { include: ['Panel', 'Text'] },
        spec: { Panel: { pick: ['title', 'data', 'pageSize'], lock: { pageSize: 50 } } },
      }),
    )

    expect(JSON.stringify(schema)).toContain('Panel')
    expect(JSON.stringify(schema)).toContain('Text')
    expect(JSON.stringify(schema)).not.toContain('Login')
    expect(JSON.stringify(schema)).toContain('"const":50')
    expect(JSON.stringify(schema)).toContain('#/$defs/dataBinding')
    expect(JSON.stringify(schema)).toContain('"const":"rest"')
    expect(JSON.stringify(schema)).toContain('"const":"static"')
  })

  it('accepts an instance-level $schema pointer (human-editing-and-persistence.md #1) via ajv against the generated schema', () => {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          specSchema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } },
        },
      ],
    })

    const schema = buildDocumentSchema(registry.scope({}))
    const ajv = new Ajv2020({ strict: false })
    const validate = ajv.compile(schema)

    const document = {
      $schema: './resourcekit-schema.json',
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Panel',
      spec: { title: 'Customers' },
    }

    expect(validate(document), validate.errors?.map((error) => error.message).join(', ')).toBe(true)
  })

  it('narrows the document root and slot items by level when rootLevels/acceptsLevels are set', () => {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Page',
          level: ['template'],
          specSchema: { type: 'object', properties: {} },
          slotPolicy: { defaultSlot: { min: 0, acceptsLevels: ['organism', 'leaf'] } },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          level: ['organism'],
          specSchema: { type: 'object', properties: {} },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Text',
          level: ['leaf'],
          specSchema: { type: 'object', properties: {} },
        },
      ],
    })

    const schema = buildDocumentSchema(registry.scope({ rootLevels: ['template'] }))
    const defs = schema.$defs as Record<string, JsonSchema>

    expect(defs.resource).toEqual({
      oneOf: [{ $ref: '#/$defs/resourcekit_dev_v1alpha1__Page' }],
    })
    const pageProperties = defs.resourcekit_dev_v1alpha1__Page.properties as Record<string, JsonSchema>
    const pageDefaultSlot = pageProperties.slots.items as JsonSchema
    const slotProperties = pageDefaultSlot.properties as Record<string, JsonSchema>
    const itemsRef = slotProperties.items.items as JsonSchema
    expect(itemsRef.$ref).toMatch(/^#\/\$defs\/accepts__/)
    expect((defs[(itemsRef.$ref as string).replace('#/$defs/', '')] as JsonSchema).oneOf).toEqual([
      { $ref: '#/$defs/resourcekit_dev_v1alpha1__Panel' },
      { $ref: '#/$defs/resourcekit_dev_v1alpha1__Text' },
    ])
  })

  it('shares one $defs entry across every slot with the same (accepts, acceptsLevels), instead of repeating the oneOf inline', () => {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Workbench',
          level: ['template'],
          specSchema: { type: 'object', properties: {} },
          slotPolicy: {
            slots: {
              leftPane: { min: 0, max: 1, acceptsLevels: ['organism', 'leaf'] },
              mainPane: { min: 1, max: 1, acceptsLevels: ['organism', 'leaf'] },
              rightPane: { min: 0, max: 1, acceptsLevels: ['organism', 'leaf'] },
            },
          },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          level: ['organism'],
          specSchema: { type: 'object', properties: {} },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Text',
          level: ['leaf'],
          specSchema: { type: 'object', properties: {} },
        },
      ],
    })

    const schema = buildDocumentSchema(registry.scope({}))
    const defs = schema.$defs as Record<string, JsonSchema>
    const acceptsDefKeys = Object.keys(defs).filter((key) => key.startsWith('accepts__'))
    expect(acceptsDefKeys).toHaveLength(1)

    const slotBranches = ((defs.resourcekit_dev_v1alpha1__Workbench.properties as Record<string, JsonSchema>).slots as JsonSchema).items as JsonSchema
    const refs = (slotBranches.oneOf as JsonSchema[]).map(
      (branch) => ((branch.properties as Record<string, JsonSchema>).items as JsonSchema).items as JsonSchema,
    )
    for (const ref of refs) expect(ref.$ref).toBe(`#/$defs/${acceptsDefKeys[0]}`)
  })
})

describe('nextStage', () => {
  function stagingRegistry() {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Page',
          level: ['template'],
          specSchema: { type: 'object', properties: {} },
          slotPolicy: {
            slots: {
              mainPane: { min: 1, max: 1, acceptsLevels: ['organism', 'leaf'] },
              sidebar: { min: 0, max: 1, accepts: ['FixedSidebar'] },
            },
          },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'FixedSidebar',
          level: ['organism'],
          specSchema: { type: 'object', properties: {} },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          level: ['organism'],
          specSchema: { type: 'object', properties: {} },
          slotPolicy: { defaultSlot: { min: 0, acceptsLevels: ['leaf'] } },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Text',
          level: ['leaf'],
          specSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
      ],
    })
    return registry
  }

  it('returns fixed when the root resolves to exactly one template-level kind', () => {
    const scoped = stagingRegistry().scope({ kinds: { include: ['Page'] }, rootLevels: ['template'] })
    const result = nextStage(scoped, {})
    expect(result.fixed).toEqual({ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Page' })
    expect(result.schema).toBeUndefined()
  })

  it('returns a schema when the root resolves to multiple candidates, scoped to envelope+spec only', () => {
    const scoped = stagingRegistry().scope({})
    const result = nextStage(scoped, {})
    expect(result.fixed).toBeUndefined()
    const schema = result.schema!
    const refs = (schema.oneOf as JsonSchema[]).map((branch) => branch.$ref)
    expect(refs).toEqual(
      expect.arrayContaining([
        '#/$defs/resourcekit_dev_v1alpha1__Page',
        '#/$defs/resourcekit_dev_v1alpha1__FixedSidebar',
        '#/$defs/resourcekit_dev_v1alpha1__Panel',
        '#/$defs/resourcekit_dev_v1alpha1__Text',
      ]),
    )
    const defs = schema.$defs as Record<string, JsonSchema>
    const pageDef = defs.resourcekit_dev_v1alpha1__Page
    expect(pageDef.properties).not.toHaveProperty('slots')
  })

  it('returns fixed for a slot whose accepts resolves to exactly one kind', () => {
    const scoped = stagingRegistry().scope({})
    const result = nextStage(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Page', slotName: 'sidebar' } })
    expect(result.fixed).toEqual({ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'FixedSidebar' })
  })

  it('returns a schema for a slot with multiple candidates via acceptsLevels', () => {
    const scoped = stagingRegistry().scope({})
    const result = nextStage(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Page', slotName: 'mainPane' } })
    const refs = (result.schema!.oneOf as JsonSchema[]).map((branch) => branch.$ref)
    expect(refs).toEqual(expect.arrayContaining(['#/$defs/resourcekit_dev_v1alpha1__Panel', '#/$defs/resourcekit_dev_v1alpha1__Text']))
  })

  it('resolves the defaultSlot when slotName is omitted', () => {
    const scoped = stagingRegistry().scope({})
    const result = nextStage(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel' } })
    expect(result.fixed).toEqual({ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text' })
  })

  it('throws for an unknown parent kind', () => {
    const scoped = stagingRegistry().scope({})
    expect(() => nextStage(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Nope' } })).toThrow(/unknown parent kind/)
  })

  it('throws for a slot the parent kind does not declare', () => {
    const scoped = stagingRegistry().scope({})
    expect(() =>
      nextStage(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Page', slotName: 'nope' } }),
    ).toThrow(/has no slot/)
  })
})

describe('nextStageBatch', () => {
  function batchRegistry() {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Workbench',
          level: ['template'],
          specSchema: { type: 'object', properties: {} },
          slotPolicy: {
            slots: {
              mainPane: { min: 1, max: 1, acceptsLevels: ['organism', 'leaf'] },
              sidebar: { min: 1, max: 1, accepts: ['FixedSidebar'] },
              note: { min: 0, max: 1, accepts: ['NoteCard'] },
              actions: { min: 0, max: 3, accepts: ['ActionButton'] },
              gallery: { min: 1, accepts: ['GalleryItemA', 'GalleryItemB'] },
            },
          },
        },
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'FixedSidebar', level: ['organism'], specSchema: { type: 'object', properties: {} } },
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'NoteCard', level: ['organism'], specSchema: { type: 'object', properties: {} } },
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'ActionButton', level: ['leaf'], specSchema: { type: 'object', properties: {} } },
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'GalleryItemA', level: ['leaf'], specSchema: { type: 'object', properties: {} } },
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'GalleryItemB', level: ['leaf'], specSchema: { type: 'object', properties: {} } },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          level: ['organism'],
          specSchema: { type: 'object', properties: {} },
          slotPolicy: { defaultSlot: { min: 1, max: 1, acceptsLevels: ['leaf'] } },
        },
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', level: ['leaf'], specSchema: { type: 'object', properties: {} } },
      ],
    })
    return registry
  }

  it('puts a mandatory single-candidate slot in fixed, with no schema entry', () => {
    const scoped = batchRegistry().scope({})
    const result = nextStageBatch(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Workbench' } })
    expect(result.fixed.sidebar).toEqual({ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'FixedSidebar' })
    const properties = result.schema!.properties as Record<string, unknown>
    expect(properties.sidebar).toBeUndefined()
  })

  it('keeps an optional single-candidate slot in schema, not fixed, as a one-option oneOf', () => {
    const scoped = batchRegistry().scope({})
    const result = nextStageBatch(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Workbench' } })
    expect(result.fixed.note).toBeUndefined()
    const properties = result.schema!.properties as Record<string, JsonSchema>
    expect((properties.note.oneOf as JsonSchema[]).length).toBe(1)
    expect(result.schema!.required).not.toContain('note')
  })

  it('puts a multi-candidate non-repeatable slot in schema as oneOf, required when min >= 1', () => {
    const scoped = batchRegistry().scope({})
    const result = nextStageBatch(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Workbench' } })
    const properties = result.schema!.properties as Record<string, JsonSchema>
    const refs = (properties.mainPane.oneOf as JsonSchema[]).map((branch) => branch.$ref)
    expect(refs).toEqual(expect.arrayContaining(['#/$defs/resourcekit_dev_v1alpha1__Panel', '#/$defs/resourcekit_dev_v1alpha1__Text']))
    expect(result.schema!.required).toContain('mainPane')
  })

  it('represents a repeatable slot as an array with minItems/maxItems, even with one candidate', () => {
    const scoped = batchRegistry().scope({})
    const result = nextStageBatch(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Workbench' } })
    const properties = result.schema!.properties as Record<string, JsonSchema>
    expect(properties.actions.type).toBe('array')
    expect(properties.actions.minItems).toBe(0)
    expect(properties.actions.maxItems).toBe(3)
    expect(result.schema!.required).not.toContain('actions')
    const items = properties.actions.items as JsonSchema
    const refs = (items.oneOf as JsonSchema[]).map((branch) => branch.$ref)
    expect(refs).toEqual(['#/$defs/resourcekit_dev_v1alpha1__ActionButton'])
  })

  it('represents a required repeatable slot with multiple candidates, capped at the default item limit', () => {
    const scoped = batchRegistry().scope({})
    const result = nextStageBatch(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Workbench' } })
    const properties = result.schema!.properties as Record<string, JsonSchema>
    expect(properties.gallery.type).toBe('array')
    expect(properties.gallery.minItems).toBe(1)
    expect(properties.gallery.maxItems).toBe(20)
    expect(result.schema!.required).toContain('gallery')
  })

  it('resolves the defaultSlot under the "(default)" key', () => {
    const scoped = batchRegistry().scope({})
    const result = nextStageBatch(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel' } })
    const properties = result.schema!.properties as Record<string, JsonSchema>
    expect(properties['(default)']).toBeDefined()
    expect(result.schema!.required).toContain('(default)')
  })

  it('returns only fixed (no schema) when a parent has no slotPolicy', () => {
    const scoped = batchRegistry().scope({})
    const result = nextStageBatch(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'FixedSidebar' } })
    expect(result).toEqual({ fixed: {} })
  })

  it('throws for an unknown parent kind', () => {
    const scoped = batchRegistry().scope({})
    expect(() => nextStageBatch(scoped, { parent: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Nope' } })).toThrow(/unknown parent kind/)
  })
})

describe('buildDocumentSchema + chartkit', () => {
  function chartRegistry() {
    const registry = createRegistry()
    registry.use(createChartKitPlugin())
    return registry
  }

  it("hoists chartkit's own $defs into the composed document's top-level $defs with rewritten, resolvable refs", () => {
    const schema = buildDocumentSchema(chartRegistry().scope({}))
    const defs = schema.$defs as Record<string, JsonSchema>

    const chartKindDef = defs.resourcekit_dev_v1alpha1__ChartKitChart
    expect(chartKindDef).toBeDefined()
    const chartProperty = ((chartKindDef.properties as Record<string, JsonSchema>).spec.properties as Record<string, JsonSchema>).chart
    expect(chartProperty.oneOf).toBeDefined()
    expect(defs.resourcekit_dev_v1alpha1__ChartKitChart__BarChartSpec).toBeDefined()
    expect(defs.resourcekit_dev_v1alpha1__ChartKitChart__BaseChartFields).toBeDefined()

    // Proves the refs actually resolve once chartkit's schema is nested inside the
    // larger composed document, not just when compiled standalone. buildDocumentSchema
    // declares the 2020-12 dialect, so validate with the matching Ajv build.
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    expect(() => ajv.compile(schema)).not.toThrow()
  })

  it('validates a well-formed chart spec and rejects an obviously wrong shape via validateResource', () => {
    const registry = chartRegistry()

    const goodChart: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'ChartKitChart',
      spec: {
        chart: {
          type: 'bar',
          categories: ['Mon', 'Tue'],
          series: [{ label: 'Requests', color: '#3b82f6', values: [10, 20] }],
        },
      },
    }
    expect(validateResource(goodChart, registry)).toEqual({ valid: true, issues: [] })

    const badChart: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'ChartKitChart',
      spec: { chart: { type: 'bar' } },
    }
    const result = validateResource(badChart, registry)
    expect(result.valid).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })
})
