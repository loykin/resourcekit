import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getValueAtPath } from '../../path'
import type { DataBinding, FieldSpec, ResourceKitPlugin, ViewStateSpec } from '../../types'
import type { KindRenderFn, RenderContext } from '../../react'
import { useBindingValue } from '../internal/bindings'

interface FieldRefSpec {
  field: string
  label?: string
}

interface SelectableListSpec {
  data: DataBinding
  idField?: string
  primary: FieldRefSpec
  secondary?: FieldRefSpec[]
}

interface DetailViewSpec {
  data?: DataBinding
  fields: FieldSpec[]
  state?: ViewStateSpec
  layout?: 'list' | 'cards'
  titleField?: string
  subtitleField?: string
  statusField?: string
}

interface ObjectFieldsSpec {
  data?: DataBinding
  valuePath?: string
  fields: Array<{ label: string; path: string; display?: 'badge' }>
}

interface JsonViewerSpec {
  data: DataBinding
  valuePath?: string
  defaultExpandedDepth?: number
}

function useRows(binding: DataBinding | undefined, ctx: RenderContext) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const bindingKey = binding ? JSON.stringify(binding) : ''
  const recordKey = binding ? '' : JSON.stringify(ctx.record ?? null)
  const refNames = useMemo(
    () => [...bindingKey.matchAll(/\$\{([^}]+)}/g)].map((match) => match[1]),
    [bindingKey],
  )
  const refFingerprint = refNames.map((name) => JSON.stringify(ctx.variables.get(name) ?? null)).join('|')

  useEffect(() => {
    let cancelled = false
    setError(null)
    if (!binding) {
      setRows(ctx.record ? [ctx.record] : [])
      return () => {
        cancelled = true
      }
    }
    ctx.data
      .resolve(binding)
      .then((next) => {
        if (!cancelled) setRows(next)
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(nextError)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingKey, recordKey, refFingerprint, ctx.data.revision])

  return { rows, error }
}

function textAt(row: Record<string, unknown>, field: string): string {
  const value = getValueAtPath(row, field)
  return value == null ? '' : String(value)
}

function SelectableList({ spec, ctx }: { spec: SelectableListSpec; ctx: RenderContext }) {
  const { rows, error } = useRows(spec.data, ctx)
  const selected = useBindingValue(ctx, 'selected')
  const idField = spec.idField ?? 'id'

  if (error) return <div className="resourcekit-state">{error instanceof Error ? error.message : 'Unable to load list'}</div>
  if (!rows) return <div className="resourcekit-state">Loading list...</div>
  if (rows.length === 0) return <div className="resourcekit-state">No items</div>

  return (
    <div className="resourcekit-selectable-list">
      {rows.map((row, index) => {
        const id = textAt(row, idField)
        const active = selected === id
        return (
          <button
            key={id || index}
            type="button"
            className={`block w-full border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 ${
              active ? 'bg-muted' : 'bg-background hover:bg-muted/60'
            }`}
            onClick={() => ctx.events.emit('select', { row })}
          >
            <div className="truncate text-sm font-medium">{textAt(row, spec.primary.field)}</div>
            {spec.secondary && spec.secondary.length > 0 && (
              <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                {spec.secondary.map((item) => (
                  <span key={item.field} className="block truncate">
                    {item.label ? `${item.label}: ` : ''}
                    {textAt(row, item.field)}
                  </span>
                ))}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

function renderFieldValue(value: unknown, field: FieldSpec): ReactNode {
  if (value == null) return null
  if (field.display === 'badge') {
    return <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs">{String(value)}</span>
  }
  if (field.display === 'boolean') return value ? 'Yes' : 'No'
  if (field.display === 'number' && typeof value === 'number') return value.toLocaleString()
  if (field.display === 'date') {
    const date = new Date(value as string | number)
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
  }
  return String(value)
}

const fieldAlignClass: Record<NonNullable<FieldSpec['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

/**
 * A single record's fields bound directly to `data`, flattening what would
 * otherwise be a RecordScope wrapping a DataBody wrapping ObjectFields.
 * Use for the detail pane of a list/detail screen.
 */
/**
 * Owns its own padding (unlike ObjectFields) since test.md §4.1's intended
 * usage is directly inside a slot like ListDetail's `detail` with no
 * DataBody/Panel wrapper providing chrome — it needs to look right standalone.
 */
function DetailView({ spec, ctx }: { spec: DetailViewSpec; ctx: RenderContext }) {
  const { rows, error } = useRows(spec.data, ctx)
  if (error) {
    return <div className="resourcekit-state p-4">{spec.state?.errorMessage ?? (error instanceof Error ? error.message : 'Unable to load detail')}</div>
  }
  if (!rows) return <div className="resourcekit-state p-4">Loading detail...</div>
  if (rows.length === 0) return <div className="resourcekit-state p-4">{spec.state?.emptyMessage ?? 'No data'}</div>

  const record = rows[0]
  if (spec.layout === 'cards') {
    const title = spec.titleField ? getValueAtPath(record, spec.titleField) : undefined
    const subtitle = spec.subtitleField ? getValueAtPath(record, spec.subtitleField) : undefined
    const status = spec.statusField ? getValueAtPath(record, spec.statusField) : undefined
    return (
      <div className="grid gap-4 p-4 text-sm">
        {(title != null || subtitle != null || status != null) && (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {title != null && <h2 className="truncate text-base font-semibold">{String(title)}</h2>}
              {subtitle != null && <p className="truncate text-sm text-muted-foreground">{String(subtitle)}</p>}
            </div>
            {status != null && (
              <span className="inline-flex shrink-0 items-center rounded-md border border-border px-2 py-0.5 text-xs capitalize">
                {String(status)}
              </span>
            )}
          </div>
        )}
        <dl className="grid gap-3 sm:grid-cols-2">
          {spec.fields.map((field) => (
            <div key={field.field} className="rounded-md border border-border p-3">
              <dt className="text-xs text-muted-foreground">{field.label ?? field.field}</dt>
              <dd className={`mt-1 ${field.emphasis === 'strong' ? 'font-semibold' : 'font-medium'}`}>
                {renderFieldValue(getValueAtPath(record, field.field), field)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }
  return (
    <dl className="grid gap-3 p-4 text-sm">
      {spec.fields.map((field) => (
        <div key={field.field} className={`grid grid-cols-[140px_1fr] gap-3 ${field.align ? fieldAlignClass[field.align] : ''}`}>
          <dt className="text-muted-foreground">{field.label ?? field.field}</dt>
          <dd className={field.emphasis === 'strong' ? 'font-semibold' : undefined}>{renderFieldValue(getValueAtPath(record, field.field), field)}</dd>
        </div>
      ))}
    </dl>
  )
}

function ObjectFields({ spec, ctx }: { spec: ObjectFieldsSpec; ctx: RenderContext }) {
  const { rows, error } = useRows(spec.data, ctx)
  if (error) return <div className="resourcekit-state">{error instanceof Error ? error.message : 'Unable to load object'}</div>
  if (!rows) return <div className="resourcekit-state">Loading object...</div>
  const value = spec.valuePath ? getValueAtPath(rows[0], spec.valuePath) : rows[0]
  const object = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

  return (
    <dl className="grid gap-3 text-sm">
      {spec.fields.map((field) => {
        const value = getValueAtPath(object, field.path)
        return (
          <div key={field.path} className="grid grid-cols-[140px_1fr] gap-3">
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd>
              {field.display === 'badge' ? (
                <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs">{value == null ? '' : String(value)}</span>
              ) : value == null ? null : (
                String(value)
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function JsonViewer({ spec, ctx }: { spec: JsonViewerSpec; ctx: RenderContext }) {
  const { rows, error } = useRows(spec.data, ctx)
  if (error) return <div className="resourcekit-state">{error instanceof Error ? error.message : 'Unable to load JSON'}</div>
  if (!rows) return <div className="resourcekit-state">Loading JSON...</div>
  const value = spec.valuePath ? getValueAtPath(rows[0], spec.valuePath) : rows
  return <pre className="overflow-auto p-4 text-xs">{JSON.stringify(value, null, 2)}</pre>
}

const fieldRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['field'],
  properties: {
    field: { type: 'string' },
    label: { type: 'string' },
  },
}

const fieldSpecSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['field'],
  properties: {
    field: { type: 'string' },
    label: { type: 'string' },
    display: { enum: ['text', 'number', 'date', 'badge', 'boolean'] },
    format: { type: 'string' },
    align: { enum: ['left', 'center', 'right'] },
    emphasis: { enum: ['normal', 'strong'] },
  },
}

const viewStateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    emptyMessage: { type: 'string' },
    errorMessage: { type: 'string' },
  },
}

export function createResourceViewPlugin(): ResourceKitPlugin<KindRenderFn> {
  return {
    name: 'resource-view-adapter',
    kinds: [
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DetailView',
        level: ['leaf'],
        description:
          'A read-only field list for a single bound record, owning its own `data` binding directly (no RecordScope/DataBody/ObjectFields nesting required). Use for the detail pane of a ListDetail, or any standalone single-record detail screen.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['fields'],
          properties: {
            data: { type: 'object' },
            fields: { type: 'array', items: fieldSpecSchema },
            state: viewStateSchema,
            layout: { enum: ['list', 'cards'] },
            titleField: { type: 'string' },
            subtitleField: { type: 'string' },
            statusField: { type: 'string' },
          },
        },
        render: (resource, ctx) => <DetailView spec={resource.spec as DetailViewSpec} ctx={ctx} />,
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'SelectableList',
        level: ['leaf'],
        description:
          'A vertical list of selectable rows bound to `data`, highlighting the row matching the `selected` binding and emitting a `select` event with the row on click. Use for the list pane of a list/detail screen.',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          required: ['data', 'primary'],
          properties: {
            data: { type: 'object' },
            idField: { type: 'string' },
            primary: fieldRefSchema,
            secondary: { type: 'array', items: fieldRefSchema },
            events: { type: 'object' },
          },
        },
        bindingPolicy: {
          inputs: {
            selected: { description: 'Currently selected row ID; bind to shared document state.', schema: { type: 'string' } },
          },
        },
        render: (resource, ctx) => <SelectableList spec={resource.spec as SelectableListSpec} ctx={ctx} />,
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'ObjectFields',
        level: ['leaf'],
        description:
          'A read-only label/value grid rendered from a single bound record\'s fields (via `fields[].path`). Use for a fixed, non-interactive detail view — for editable or structured field grouping, use DataBodyGroup/DataBodyRow/DataBodyField instead.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['fields'],
          properties: {
            data: { type: 'object' },
            valuePath: { type: 'string' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['label', 'path'],
                properties: {
                  label: { type: 'string' },
                  path: { type: 'string' },
                  display: { const: 'badge' },
                },
              },
            },
          },
        },
        render: (resource, ctx) => <ObjectFields spec={resource.spec as ObjectFieldsSpec} ctx={ctx} />,
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'JsonViewer',
        level: ['leaf'],
        description: 'A raw, syntax-highlighted JSON viewer for a bound value. Use for debugging/inspector views, not end-user content.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: { type: 'object' },
            valuePath: { type: 'string' },
            defaultExpandedDepth: { type: 'number' },
          },
        },
        render: (resource, ctx) => <JsonViewer spec={resource.spec as JsonViewerSpec} ctx={ctx} />,
      },
    ],
  }
}
