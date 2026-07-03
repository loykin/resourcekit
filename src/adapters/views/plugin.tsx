import { useEffect, useMemo, useState } from 'react'
import { getValueAtPath } from '../../path'
import type { DataBinding, ResourceKitPlugin } from '../../types'
import type { KindRenderFn, RenderContext } from '../../react/types'
import { variableName } from '../internal/shared'

interface FieldRefSpec {
  field: string
  label?: string
}

interface SelectableListSpec {
  data: DataBinding
  idField?: string
  selectedRef?: string
  primary: FieldRefSpec
  secondary?: FieldRefSpec[]
}

interface ObjectFieldsSpec {
  data: DataBinding
  valuePath?: string
  fields: Array<{ label: string; path: string; display?: 'badge' }>
}

interface JsonViewerSpec {
  data: DataBinding
  valuePath?: string
  defaultExpandedDepth?: number
}

function useRows(binding: DataBinding, ctx: RenderContext) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const bindingKey = JSON.stringify(binding)
  const refNames = useMemo(
    () => [...bindingKey.matchAll(/\$\{([^}]+)}/g)].map((match) => match[1]),
    [bindingKey],
  )
  const refFingerprint = refNames.map((name) => JSON.stringify(ctx.variables.get(name) ?? null)).join('|')

  useEffect(() => {
    let cancelled = false
    setError(null)
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
  }, [bindingKey, refFingerprint])

  return { rows, error }
}

function textAt(row: Record<string, unknown>, field: string): string {
  const value = getValueAtPath(row, field)
  return value == null ? '' : String(value)
}

function SelectableList({ spec, ctx }: { spec: SelectableListSpec; ctx: RenderContext }) {
  const { rows, error } = useRows(spec.data, ctx)
  const selectedVariable = variableName(spec.selectedRef)
  const selected = selectedVariable ? ctx.variables.get(selectedVariable) : undefined
  const idField = spec.idField ?? 'id'

  if (error) return <div className="resourcekit-state">{error instanceof Error ? error.message : 'Unable to load list'}</div>
  if (!rows) return <div className="resourcekit-state">Loading list...</div>
  if (rows.length === 0) return <div className="resourcekit-state">No items</div>

  return (
    <div className="resourcekit-selectable-list divide-y">
      {rows.map((row, index) => {
        const id = textAt(row, idField)
        const active = selected === id
        return (
          <button
            key={id || index}
            type="button"
            className={`block w-full px-4 py-3 text-left transition-colors ${active ? 'bg-muted' : 'hover:bg-muted/60'}`}
            onClick={() => ctx.events.emit('select', { row })}
          >
            <div className="truncate text-sm font-medium">{textAt(row, spec.primary.field)}</div>
            {spec.secondary && spec.secondary.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {spec.secondary.map((item) => (
                  <span key={item.field} className="truncate">
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

function ObjectFields({ spec, ctx }: { spec: ObjectFieldsSpec; ctx: RenderContext }) {
  const { rows, error } = useRows(spec.data, ctx)
  if (error) return <div className="resourcekit-state">{error instanceof Error ? error.message : 'Unable to load object'}</div>
  if (!rows) return <div className="resourcekit-state">Loading object...</div>
  const value = spec.valuePath ? getValueAtPath(rows[0], spec.valuePath) : rows[0]
  const object = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

  return (
    <dl className="grid gap-3 p-4 text-sm">
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

export function createResourceViewPlugin(): ResourceKitPlugin<KindRenderFn> {
  return {
    name: 'resource-view-adapter',
    kinds: [
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'SelectableList',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          required: ['data', 'primary'],
          properties: {
            data: { type: 'object' },
            idField: { type: 'string' },
            selectedRef: { type: 'string' },
            primary: { type: 'object' },
            secondary: { type: 'array', items: { type: 'object' } },
            events: { type: 'object' },
          },
        },
        render: (resource, ctx) => <SelectableList spec={resource.spec as SelectableListSpec} ctx={ctx} />,
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'ObjectFields',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['data', 'fields'],
          properties: {
            data: { type: 'object' },
            valuePath: { type: 'string' },
            fields: { type: 'array', items: { type: 'object' } },
          },
        },
        render: (resource, ctx) => <ObjectFields spec={resource.spec as ObjectFieldsSpec} ctx={ctx} />,
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'JsonViewer',
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
