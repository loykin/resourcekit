import { ChartRenderer } from '@loykin/chartkit'
import type { ComponentType } from 'react'
import type { ResourceKitPlugin } from '../../types'
import type { KindRenderFn } from '../../react/types'
import { withKindAliases } from '../internal/shared'

interface ChartSpecResource {
  chart: unknown
}

const KitChart = ChartRenderer as unknown as ComponentType<Record<string, unknown>>

export function createChartKitPlugin(): ResourceKitPlugin<KindRenderFn> {
  return withKindAliases(
    {
      name: 'chartkit-adapter',
      kinds: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'ChartKitChart',
          specSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['chart'],
            properties: {
              chart: { type: 'object', additionalProperties: true },
            },
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
