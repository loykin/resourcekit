import { FilterInput } from '@loykin/filter-input'
import type { ComponentType } from 'react'
import type { JsonSchema, ResourceKitPlugin } from '../../core/types'
import type { KindRenderFn, RenderContext } from '../../react'
import { useBindingValue } from '../internal/bindings'
import { withKindAliases } from '../internal/shared'

interface FilterInputSpec {
  config: unknown
  value?: unknown
}

const KitFilterInput = FilterInput as ComponentType<Record<string, unknown>>

function FilterControlNode({ spec, ctx }: { spec: FilterInputSpec; ctx: RenderContext }) {
  const value = useBindingValue(ctx, 'value', spec.value)
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
}

// Mirrors `FilterInputConfig` from `@loykin/filter-input`'s src/types.ts. `dataSource.fetch`
// and `display.formatLabel` are functions, not representable in JSON Schema, so are omitted.
const filterInputConfigSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'type'],
  properties: {
    key: { type: 'string' },
    label: { type: 'string' },
    type: {
      type: 'string',
      enum: [
        'text', 'textarea', 'number', 'boolean', 'select', 'multi-select', 'autocomplete',
        'combobox', 'date', 'date-range', 'datetime', 'datetime-range', 'range', 'tag',
      ],
    },
    placeholder: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value'],
        properties: {
          label: { type: 'string' },
          value: { type: ['string', 'number', 'boolean'] },
          disabled: { type: 'boolean' },
          color: { type: 'string' },
        },
      },
    },
    dataSource: {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { type: 'string', enum: ['static', 'remote'] },
        trigger: { type: 'string', enum: ['immediate', 'open'] },
      },
    },
    behavior: {
      type: 'object',
      additionalProperties: false,
      properties: {
        searchable: { type: 'boolean' },
        clearable: { type: 'boolean' },
        disabled: { type: 'boolean' },
        required: { type: 'boolean' },
        closeOnSelect: { type: 'boolean' },
        debounceMs: { type: 'number' },
        minSearchLength: { type: 'number' },
        allowCustomValue: { type: 'boolean' },
        selectOnBlur: { type: 'boolean' },
        showReload: { type: 'boolean' },
      },
    },
    display: {
      type: 'object',
      additionalProperties: false,
      properties: {
        variant: { type: 'string', enum: ['text', 'tags', 'count', 'summary'] },
        maxVisible: { type: 'number' },
        overflow: { type: 'string', enum: ['count', 'collapse', 'tooltip'] },
        removable: { type: 'boolean' },
        size: { type: 'string', enum: ['sm', 'md', 'lg'] },
        colorBy: { type: 'string', enum: ['none', 'value', 'option-meta'] },
        emptyText: { type: 'string' },
        summaryLabel: { type: 'string' },
      },
    },
    validation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        min: { type: 'number' },
        max: { type: 'number' },
        pattern: { type: 'string' },
      },
    },
  },
}

export function createBaseKitPlugin(): ResourceKitPlugin<KindRenderFn> {
  return withKindAliases(
    {
      name: 'basekit-adapter',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'BaseKitFilterInput',
          level: ['leaf'],
          description: 'A single filter control (select/date/text/etc., per `config`) whose current value comes from the `value` binding.',
          specSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['config'],
            properties: {
              config: filterInputConfigSchema,
              value: {},
              events: { type: 'object' },
            },
          },
          bindingPolicy: {
            inputs: {
              value: { description: 'Current filter value; bind to shared document state.' },
            },
          },
          render: (resource, ctx) => {
            const spec = resource.spec as FilterInputSpec
            return <FilterControlNode spec={spec} ctx={ctx} />
          },
        },
      ],
    },
    [['BaseKitFilterInput', 'FilterControl']],
  )
}
