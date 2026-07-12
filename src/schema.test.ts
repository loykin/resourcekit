import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import { createChartKitPlugin } from './adapters/chartkit/plugin'
import { createRegistry } from './registry'
import { restResolver, staticResolver } from './resolvers'
import { buildDocumentSchema } from './schema'
import type { JsonSchema, LoykinResource } from './types'
import { validateResource } from './validation'

describe('buildDocumentSchema', () => {
  it('builds a scoped recursive schema from registered manifests and resolvers', () => {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Text',
          specSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
        {
          apiVersion: 'loykin.dev/v1alpha1',
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

    const chartKindDef = defs.loykin_dev_v1alpha1__ChartKitChart
    expect(chartKindDef).toBeDefined()
    const chartProperty = ((chartKindDef.properties as Record<string, JsonSchema>).spec.properties as Record<string, JsonSchema>).chart
    expect(chartProperty.oneOf).toBeDefined()
    expect(defs.loykin_dev_v1alpha1__ChartKitChart__BarChartSpec).toBeDefined()
    expect(defs.loykin_dev_v1alpha1__ChartKitChart__BaseChartFields).toBeDefined()

    // Proves the refs actually resolve once chartkit's schema is nested inside the
    // larger composed document, not just when compiled standalone. buildDocumentSchema
    // declares the 2020-12 dialect, so validate with the matching Ajv build.
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    expect(() => ajv.compile(schema)).not.toThrow()
  })

  it('validates a well-formed chart spec and rejects an obviously wrong shape via validateResource', () => {
    const registry = chartRegistry()

    const goodChart: LoykinResource = {
      apiVersion: 'loykin.dev/v1alpha1',
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

    const badChart: LoykinResource = {
      apiVersion: 'loykin.dev/v1alpha1',
      kind: 'ChartKitChart',
      spec: { chart: { type: 'bar' } },
    }
    const result = validateResource(badChart, registry)
    expect(result.valid).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })
})
