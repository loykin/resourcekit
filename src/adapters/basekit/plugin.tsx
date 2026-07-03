import { FilterInput } from '@loykin/filter-input'
import type { ComponentType } from 'react'
import type { ResourceKitPlugin } from '../../types'
import type { KindRenderFn } from '../../react/types'
import { variableName, withKindAliases } from '../internal/shared'

interface FilterInputSpec {
  config: unknown
  valueRef?: string
  value?: unknown
}

const KitFilterInput = FilterInput as ComponentType<Record<string, unknown>>

export function createBaseKitPlugin(): ResourceKitPlugin<KindRenderFn> {
  return withKindAliases(
    {
      name: 'basekit-adapter',
      kinds: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'BaseKitFilterInput',
          specSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['config'],
            properties: {
              config: { type: 'object' },
              valueRef: { type: 'string' },
              value: {},
              events: { type: 'object' },
            },
          },
          render: (resource, ctx) => {
            const spec = resource.spec as FilterInputSpec
            const variable = variableName(spec.valueRef)
            const value = variable ? ctx.variables.get(variable) : spec.value
            return (
              <div className="min-w-[14rem] max-w-full shrink-0 overflow-visible">
                <KitFilterInput
                  className="w-full"
                  classNames={{ row: 'flex-nowrap', control: 'min-w-0', clearButton: 'shrink-0' }}
                  config={spec.config}
                  value={value}
                  onChange={(nextValue: unknown) => ctx.events.emit('change', { value: nextValue })}
                />
              </div>
            )
          },
        },
      ],
    },
    [['BaseKitFilterInput', 'FilterControl']],
  )
}
