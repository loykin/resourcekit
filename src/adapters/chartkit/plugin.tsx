import { CHART_SPEC_SCHEMA, ChartRenderer } from '@loykin/chartkit'
import type { ComponentType } from 'react'
import type { JsonSchema, ResourceKitPlugin } from '../../types'
import type { KindRenderFn } from '../../react/types'
import { withKindAliases } from '../internal/shared'

interface ChartSpecResource {
  chart: unknown
}

const KitChart = ChartRenderer as unknown as ComponentType<Record<string, unknown>>

/**
 * chartkit ships `CHART_SPEC_SCHEMA` as a self-contained draft-07 document
 * (`definitions` + `#/definitions/X` refs). resourcekit's own schema
 * generation (see `buildDocumentSchema` in `src/schema.ts`) uses `$defs` +
 * `#/$defs/X` instead, and hoists any `$defs` a specSchema carries into the
 * composed document's top-level `$defs` — so the refs just need renaming to
 * that convention; the hoisting itself is generic, not chart-specific.
 */
function rewriteDefinitionsToDefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteDefinitionsToDefs)
  if (typeof value !== 'object' || value === null) return value
  const object = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(object)) {
    result[key] =
      key === '$ref' && typeof item === 'string' && item.startsWith('#/definitions/')
        ? `#/$defs/${item.slice('#/definitions/'.length)}`
        : rewriteDefinitionsToDefs(item)
  }
  return result
}

const chartProperty: JsonSchema = rewriteDefinitionsToDefs({
  oneOf: CHART_SPEC_SCHEMA.oneOf,
  description: CHART_SPEC_SCHEMA.description,
}) as JsonSchema
const chartDefs: Record<string, unknown> = rewriteDefinitionsToDefs(CHART_SPEC_SCHEMA.definitions) as Record<string, unknown>

export function createChartKitPlugin(): ResourceKitPlugin<KindRenderFn> {
  return withKindAliases(
    {
      name: 'chartkit-adapter',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ChartKitChart',
          level: ['leaf'],
          description: 'A chart (bar/line/pie/etc., per `chart.type`) rendered from an inline spec.',
          specSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['chart'],
            properties: {
              chart: chartProperty,
            },
            $defs: chartDefs,
          },
          render: (resource) => {
            const spec = resource.spec as ChartSpecResource
            return <KitChart spec={spec.chart} />
          },
        },
      ],
    },
    [['ChartKitChart', 'ChartView']],
  )
}
