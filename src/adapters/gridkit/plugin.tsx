import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { DataGrid, DataGridPaginationCompact, GlobalSearch, inferTablePayload } from '@loykin/gridkit'
import { getValueAtPath } from '../../path'
import type { DataBinding, ResourceKitPlugin } from '../../types'
import type { KindRenderFn, RenderContext } from '../../react/types'
import { withKindAliases } from '../internal/shared'

interface ColumnHint {
  label?: string
  type?: 'text' | 'number' | 'date' | 'boolean'
  align?: 'left' | 'center' | 'right'
  flex?: number
  emphasis?: 'strong'
  tone?: 'muted'
  display?: 'badge'
  variant?: string
  map?: Record<string, string>
}

interface GridTableSpec {
  title?: string
  data: DataBinding
  columns?: Record<string, ColumnHint>
  enableSorting?: boolean
  enableColumnFilters?: boolean
  filterDisplay?: 'row' | 'icon'
  globalSearch?: boolean
  searchPlaceholder?: string
  searchableColumns?: string[]
  tableHeight?: number | string
  pagination?: { pageSize?: number }
  inferOptions?: { hints?: Record<string, Partial<ColumnHint>> }
}

type CellCtx = { getValue: () => unknown }

function originalRow(row: unknown): unknown {
  if (typeof row === 'object' && row !== null && 'original' in row) {
    return (row as { original: unknown }).original
  }
  return row
}

function formatByType(value: unknown, type: string | undefined): ReactNode {
  if (value == null) return null
  if (type === 'number') return Number(value).toLocaleString()
  if (type === 'date') {
    const date = new Date(value as string | number)
    return isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
  }
  if (type === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function badgeToneClass(variant: string | undefined): string {
  if (variant === 'default') return 'border-transparent bg-primary text-primary-foreground'
  if (variant === 'secondary') return 'border-transparent bg-secondary text-secondary-foreground'
  if (variant === 'destructive') return 'border-transparent bg-destructive text-destructive-foreground'
  return 'border-border text-foreground'
}

function buildHintCell(type: string | undefined, hint: ColumnHint | undefined): ((cell: CellCtx) => ReactNode) | undefined {
  if (!hint?.display && !hint?.emphasis && !hint?.tone && type !== 'number' && type !== 'date' && type !== 'boolean') {
    return undefined
  }
  return ({ getValue }: CellCtx) => {
    const value = getValue()
    if (value == null) return null
    if (hint?.display === 'badge') {
      const variant = hint.map?.[String(value)] ?? hint.variant ?? 'outline'
      return (
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-normal ${badgeToneClass(variant)}`}>
          {String(value)}
        </span>
      )
    }
    const formatted = formatByType(value, type)
    if (hint?.emphasis === 'strong') return <span className="font-medium">{formatted}</span>
    if (hint?.tone === 'muted') return <span className="text-muted-foreground">{formatted}</span>
    return formatted
  }
}

function ResourceDataGrid({ spec, ctx }: { spec: GridTableSpec; ctx: RenderContext }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  const bindingKey = JSON.stringify(spec.data)
  const refNames = useMemo(
    () => [...bindingKey.matchAll(/\$\{([^}]+)}/g)].map((match) => match[1]),
    [bindingKey],
  )
  const refFingerprint = refNames.map((name) => JSON.stringify(ctx.variables.get(name) ?? null)).join('|')

  useEffect(() => {
    let cancelled = false
    setError(null)
    ctx.data
      .resolve(spec.data)
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
  }, [bindingKey, refFingerprint, ctx.data.revision])

  const columns = useMemo(() => {
    if (!rows) return []
    const explicitColumns = Object.entries(spec.columns ?? {})

    // `columns` given: it's an allowlist, not decoration — only these show, in
    // this order. Keys are dot-paths (getValueAtPath), so nested fields like
    // "company.name" work without the row needing that exact top-level key.
    if (explicitColumns.length > 0) {
      return explicitColumns.map(([key, hint]) => {
        const cell = buildHintCell(hint.type, hint)
        return {
          id: key,
          accessorFn: (row: Record<string, unknown>) => getValueAtPath(row, key),
          header: hint.label ?? key,
          ...(cell ? { cell } : {}),
          meta: { align: hint.align, flex: hint.flex ?? 1 },
        }
      })
    }

    // No `columns`: auto-infer every top-level field from the row shape.
    const payload = inferTablePayload(rows, {
      title: spec.title,
      hints: Object.fromEntries(
        Object.entries(spec.inferOptions?.hints ?? {}).map(([key, hint]) => [
          key,
          {
            ...(hint.label !== undefined ? { label: hint.label } : {}),
            ...(hint.type !== undefined ? { type: hint.type } : {}),
            ...(hint.align !== undefined ? { align: hint.align } : {}),
            ...(hint.flex !== undefined ? { flex: hint.flex } : {}),
          },
        ]),
      ),
    })
    return payload.columns.map((col) => {
      const cell = buildHintCell(col.type, undefined)
      return {
        id: col.key,
        accessorKey: col.key,
        header: col.label,
        ...(cell ? { cell } : {}),
        meta: { align: col.align, flex: col.flex ?? 1 },
      }
    })
  }, [rows, spec.columns, spec.inferOptions, spec.title])

  if (error) return <div className="resourcekit-state">{error instanceof Error ? error.message : 'Unable to load rows'}</div>
  if (!rows) return <div className="resourcekit-state">Loading rows...</div>

  return (
    <DataGrid
      data={rows}
      columns={columns}
      enableSorting={spec.enableSorting}
      enableColumnFilters={spec.enableColumnFilters}
      filterDisplay={spec.filterDisplay}
      headerLeft={
        spec.globalSearch
          ? (table: unknown) => <GlobalSearch table={table as never} placeholder={spec.searchPlaceholder ?? 'Search...'} />
          : undefined
      }
      headerRight={spec.pagination ? (table: unknown) => <DataGridPaginationCompact table={table as never} /> : undefined}
      onRowClick={(row: unknown) => ctx.events.emit('rowSelect', { row: originalRow(row) })}
      pagination={spec.pagination}
      searchableColumns={spec.searchableColumns}
      tableHeight={spec.tableHeight}
    />
  )
}

export function createGridKitPlugin(): ResourceKitPlugin<KindRenderFn> {
  return withKindAliases(
    {
      name: 'gridkit-adapter',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'GridKitTable',
          level: ['leaf'],
          description:
            'A data table/grid bound to `data`. Omit `columns` to show every top-level field of each row; set `columns` to show only those, in that order — its keys are dot-paths into the row (e.g. "company.name" reaches a nested field), not necessarily top-level keys, which also lets you flatten nested API responses into a flat table.',
          specSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['data'],
            properties: {
              title: { type: 'string' },
              data: { type: 'object' },
              columns: {
                type: 'object',
                description:
                  'Ordered allowlist of columns to show, keyed by dot-path into each row (e.g. "name", "company.name"). Omit entirely to auto-infer every top-level field instead.',
                additionalProperties: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    label: { type: 'string', description: 'Column header. Defaults to the dot-path key.' },
                    type: { enum: ['text', 'number', 'date', 'boolean'] },
                    align: { enum: ['left', 'center', 'right'] },
                    flex: { type: 'number', description: 'Relative column width. Default: 1.' },
                    emphasis: { enum: ['strong'] },
                    tone: { enum: ['muted'] },
                    display: { enum: ['badge'] },
                    variant: { type: 'string', description: 'Badge variant when display is "badge".' },
                    map: {
                      type: 'object',
                      additionalProperties: { type: 'string' },
                      description: 'Maps a cell value to a badge variant when display is "badge".',
                    },
                  },
                },
              },
              enableSorting: { type: 'boolean' },
              enableColumnFilters: { type: 'boolean' },
              filterDisplay: { type: 'string' },
              globalSearch: { type: 'boolean' },
              searchPlaceholder: { type: 'string' },
              searchableColumns: { type: 'array', items: { type: 'string' } },
              tableHeight: {},
              pagination: { type: 'object' },
              inferOptions: { type: 'object' },
              events: { type: 'object' },
            },
          },
          render: (resource, ctx) => <ResourceDataGrid spec={resource.spec as GridTableSpec} ctx={ctx} />,
        },
      ],
    },
    [['GridKitTable', 'TableView']],
  )
}
