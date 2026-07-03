import { useEffect, useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import {
  Badge,
  Button,
  DataBodyTemplate,
  Input,
  ListDetailBodyTemplate,
  PanelTemplate,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  WorkbenchBodyTemplate,
} from '@loykin/designkit'
import { ChartRenderer } from '@loykin/chartkit'
import { FilterInput } from '@loykin/filter-input'
import { DataGrid, DataGridPaginationCompact, GlobalSearch, inferTablePayload } from '@loykin/gridkit'
import { getValueAtPath } from '@loykin/resourcekit'
import type { DataBinding, ResourceKitPlugin, SubmitSpec } from '@loykin/resourcekit'
import type { KindRenderFn, RenderContext } from '@loykin/resourcekit/react'

interface ListDetailSpec {
  listWidth?: number
  selectionVariable?: string
}

interface WorkbenchSpec {
  leftWidth?: number
  rightWidth?: number
}

interface DataBodySpec {
  title?: string
  description?: string
  defaultTab?: string
  status?: ReactNode
}

interface DataBodyGroupSpec {
  title?: string
  description?: string
  layout?: string
  variant?: string
}

interface DataBodyRowSpec {
  label?: string
  description?: string
  required?: boolean
}

interface DataBodyFieldSpec {
  label: string
  description?: string
  value?: string
  valueRef?: string
  /** Dot-path into the nearest record scope (ctx.record). */
  fieldRef?: string
}

interface PanelSpec {
  title?: string
  eyebrow?: string
}

interface TextSpec {
  text?: string
}

interface BadgeSpec {
  label?: string
  variant?: string
}

interface ButtonSpec {
  label?: string
  value?: string
  variant?: string
  size?: string
}

interface InputSpec {
  name?: string
  placeholder?: string
  type?: string
  value?: string
  valueRef?: string
  /** Dot-path into the nearest record scope — prefills the input. */
  fieldRef?: string
}

interface FormSpec {
  submit: SubmitSpec
  submitLabel?: string
  successMessage?: string
}

interface SheetSpec {
  /** Truthy variable value opens the sheet; closing clears the variable. */
  openVariable: string
  title?: string
  side?: 'left' | 'right' | 'top' | 'bottom'
  width?: number
}

/**
 * Declarative per-column presentation — the JSON-expressible replacement for
 * hand-written TanStack cell renderers.
 */
interface ColumnHint {
  label?: string
  type?: 'text' | 'number' | 'date' | 'boolean'
  align?: 'left' | 'center' | 'right'
  flex?: number
  /** 'strong' renders the value in medium weight. */
  emphasis?: 'strong'
  /** 'muted' renders the value in muted foreground color. */
  tone?: 'muted'
  /** 'badge' wraps the value in a designkit Badge. */
  display?: 'badge'
  /** Badge variant when display is 'badge'. Default: 'outline'. */
  variant?: string
  /** Per-value badge variant map, e.g. { Active: 'default', Pending: 'secondary' }. */
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

interface ChartSpecResource {
  chart: unknown
}

interface FilterInputSpec {
  config: unknown
  valueRef?: string
  value?: unknown
}

const KitBadge = Badge as ComponentType<Record<string, unknown>>
const KitButton = Button as ComponentType<Record<string, unknown>>
const KitDataBody = DataBodyTemplate as ComponentType<Record<string, unknown>>
const KitDataBodyGroup = DataBodyTemplate.Group as ComponentType<Record<string, unknown>>
const KitDataBodyRow = DataBodyTemplate.Row as unknown as ComponentType<Record<string, unknown>>
const KitDataBodyField = DataBodyTemplate.Field as unknown as ComponentType<Record<string, unknown>>
const KitInput = Input as ComponentType<Record<string, unknown>>
const KitListDetail = ListDetailBodyTemplate as unknown as ComponentType<Record<string, unknown>>
const KitPanel = PanelTemplate as ComponentType<Record<string, unknown>>
const KitWorkbench = WorkbenchBodyTemplate as ComponentType<Record<string, unknown>>
const KitChart = ChartRenderer as unknown as ComponentType<Record<string, unknown>>
const KitFilterInput = FilterInput as ComponentType<Record<string, unknown>>
const KitDataGrid = DataGrid as unknown as ComponentType<Record<string, unknown>>

function variableName(ref: string | undefined): string | undefined {
  return ref?.startsWith('variables.') ? ref.slice('variables.'.length) : undefined
}

function originalRow(row: unknown): unknown {
  if (typeof row === 'object' && row !== null && 'original' in row) {
    return (row as { original: unknown }).original
  }
  return row
}

type CellCtx = { getValue: () => unknown }

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
        <KitBadge variant={variant} className="text-xs font-normal">
          {String(value)}
        </KitBadge>
      )
    }
    const formatted = formatByType(value, type)
    if (hint?.emphasis === 'strong') return <span className="font-medium">{formatted}</span>
    if (hint?.tone === 'muted') return <span className="text-muted-foreground">{formatted}</span>
    return formatted
  }
}

/**
 * Native-form kind body: collects named inputs via FormData on submit and
 * dispatches the declarative submit through the runtime. Form state stays
 * inside the form — it never leaks into the page variable scope.
 */
function ResourceForm({ spec, ctx }: { spec: FormSpec; ctx: RenderContext }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>()

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const payload = Object.fromEntries(new FormData(event.currentTarget).entries())
        setBusy(true)
        setMessage(undefined)
        ctx.actions
          .submit(spec.submit, payload)
          .then(() => setMessage({ tone: 'ok', text: spec.successMessage ?? 'Saved' }))
          .catch((error: unknown) =>
            setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Submit failed' }),
          )
          .finally(() => setBusy(false))
      }}
    >
      {ctx.slots.children()}
      <div className="flex items-center gap-3 px-4 py-3">
        <KitButton type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : (spec.submitLabel ?? 'Save')}
        </KitButton>
        {message && (
          <span className={message.tone === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  )
}

/**
 * Data-bound grid: resolves the binding through the runtime, infers columns,
 * then applies declarative ColumnHint presentation. Re-resolves when a
 * `${var}` referenced by the binding changes.
 */
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
  }, [bindingKey, refFingerprint])

  const columns = useMemo(() => {
    if (!rows) return []
    const inferHints: Record<string, Partial<ColumnHint>> = { ...spec.inferOptions?.hints }
    for (const [key, hint] of Object.entries(spec.columns ?? {})) {
      inferHints[key] = { ...inferHints[key], ...hint }
    }
    const payload = inferTablePayload(rows, {
      title: spec.title,
      hints: Object.fromEntries(
        Object.entries(inferHints).map(([key, hint]) => [
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
      const cell = buildHintCell(col.type, spec.columns?.[col.key])
      return {
        id: col.key,
        accessorKey: col.key,
        header: col.label,
        ...(cell ? { cell } : {}),
        meta: { align: col.align, flex: col.flex ?? 1 },
      }
    })
  }, [rows, spec.columns, spec.inferOptions, spec.title])

  if (error) {
    return <div className="resourcekit-state">{error instanceof Error ? error.message : 'Unable to load rows'}</div>
  }
  if (!rows) {
    return <div className="resourcekit-state">Loading rows...</div>
  }

  return (
    <KitDataGrid
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

export function createPlaygroundResourceAdapters(): ResourceKitPlugin<KindRenderFn> {
  return {
    name: 'playground-kit-adapters',
    kinds: [
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitListDetail',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            listWidth: { type: 'number' },
            selectionVariable: { type: 'string' },
            variables: { type: 'array' },
          },
        },
        slotPolicy: {
          slots: {
            topBar: { min: 0, max: 1 },
            list: { min: 1, max: 1 },
            detail: { min: 0, max: 1 },
            emptyDetail: { min: 0, max: 1 },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as ListDetailSpec
          const selectionVariable = spec.selectionVariable ?? (ctx.variables.get('customerId') === undefined ? undefined : 'customerId')
          const hasSelection = selectionVariable ? Boolean(ctx.variables.get(selectionVariable)) : true
          const emptyDetail = ctx.slots.one('emptyDetail')
          return (
            <KitListDetail
              topBar={ctx.slots.one('topBar')}
              list={ctx.slots.requiredOne('list')}
              detail={emptyDetail && !hasSelection ? undefined : ctx.slots.one('detail')}
              emptyDetail={emptyDetail}
              listWidth={spec.listWidth}
              onBack={selectionVariable ? () => ctx.variables.set(selectionVariable, undefined) : undefined}
            />
          )
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitWorkbench',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            leftWidth: { type: 'number' },
            rightWidth: { type: 'number' },
          },
        },
        slotPolicy: {
          slots: {
            topBar: { min: 0, max: 1 },
            headerRight: { min: 0, max: 1 },
            actions: { min: 0, max: 1 },
            leftPane: { min: 0, max: 1 },
            mainPane: { min: 1, max: 1 },
            rightPane: { min: 0, max: 1 },
            bottomPane: { min: 0, max: 1 },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as WorkbenchSpec
          return (
            <KitWorkbench
              topBar={ctx.slots.one('topBar')}
              headerRight={ctx.slots.one('headerRight')}
              actions={ctx.slots.one('actions')}
              leftPane={ctx.slots.one('leftPane')}
              mainPane={ctx.slots.requiredOne('mainPane')}
              rightPane={ctx.slots.one('rightPane')}
              bottomPane={ctx.slots.one('bottomPane')}
              leftWidth={spec.leftWidth}
              rightWidth={spec.rightWidth}
            />
          )
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitDataBody',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            defaultTab: { type: 'string' },
            status: {},
          },
        },
        slotPolicy: {
          defaultSlot: { min: 0 },
          slots: {
            topBar: { min: 0, max: 1 },
            actions: { min: 0, max: 1 },
            toolbarLeft: { min: 0, max: 1 },
            toolbarRight: { min: 0, max: 1 },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as DataBodySpec
          return (
            <KitDataBody
              title={spec.title}
              description={spec.description}
              defaultTab={spec.defaultTab}
              topBar={ctx.slots.one('topBar')}
              status={spec.status ?? ctx.slots.one('status')}
              actions={ctx.slots.one('actions')}
              toolbarLeft={ctx.slots.one('toolbarLeft')}
              toolbarRight={ctx.slots.one('toolbarRight')}
            >
              {ctx.slots.children()}
            </KitDataBody>
          )
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitDataBodyGroup',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            layout: { type: 'string' },
            variant: { type: 'string' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          const spec = resource.spec as DataBodyGroupSpec
          return (
            <KitDataBodyGroup title={spec.title} description={spec.description} layout={spec.layout} variant={spec.variant}>
              {ctx.slots.children()}
            </KitDataBodyGroup>
          )
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitDataBodyRow',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            label: { type: 'string' },
            description: { type: 'string' },
            required: { type: 'boolean' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          const spec = resource.spec as DataBodyRowSpec
          return (
            <KitDataBodyRow label={spec.label} description={spec.description} required={spec.required}>
              {ctx.slots.children()}
            </KitDataBodyRow>
          )
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitDataBodyField',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['label'],
          properties: {
            label: { type: 'string' },
            description: { type: 'string' },
            value: { type: 'string' },
            valueRef: { type: 'string' },
            fieldRef: { type: 'string' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          const spec = resource.spec as DataBodyFieldSpec
          const variable = variableName(spec.valueRef)
          const fieldValue = spec.fieldRef !== undefined ? getValueAtPath(ctx.record, spec.fieldRef) : undefined
          const value = fieldValue ?? (variable ? ctx.variables.get(variable) : spec.value)
          return (
            <KitDataBodyField label={spec.label} description={spec.description}>
              {ctx.slots.children() ?? (value == null ? null : String(value))}
            </KitDataBodyField>
          )
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitPanel',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            title: { type: 'string' },
            eyebrow: { type: 'string' },
          },
        },
        slotPolicy: {
          defaultSlot: { min: 0 },
          slots: {
            actions: { min: 0, max: 1 },
            footer: { min: 0, max: 1 },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as PanelSpec
          return (
            <KitPanel title={spec.title} eyebrow={spec.eyebrow} actions={ctx.slots.one('actions')} footer={ctx.slots.one('footer')}>
              {ctx.slots.children()}
            </KitPanel>
          )
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitText',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string' } },
        },
        render: (resource) => {
          const spec = resource.spec as TextSpec
          return <p className="resourcekit-text">{spec.text}</p>
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitBadge',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            label: { type: 'string' },
            variant: { type: 'string' },
          },
        },
        render: (resource) => {
          const spec = resource.spec as BadgeSpec
          return <KitBadge variant={spec.variant}>{spec.label}</KitBadge>
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitButton',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            label: { type: 'string' },
            value: { type: 'string' },
            variant: { type: 'string' },
            size: { type: 'string' },
            events: { type: 'object' },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as ButtonSpec
          return (
            <KitButton type="button" variant={spec.variant} size={spec.size} onClick={() => ctx.events.emit('click', { value: spec.value })}>
              {spec.label}
            </KitButton>
          )
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitInput',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            placeholder: { type: 'string' },
            type: { type: 'string' },
            value: { type: 'string' },
            valueRef: { type: 'string' },
            fieldRef: { type: 'string' },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as InputSpec
          const variable = variableName(spec.valueRef)
          const fieldValue = spec.fieldRef !== undefined ? getValueAtPath(ctx.record, spec.fieldRef) : undefined
          const raw = fieldValue ?? (variable ? ctx.variables.get(variable) : spec.value)
          const value = raw == null ? undefined : String(raw)
          return (
            <KitInput
              key={`${spec.name ?? ''}:${value ?? ''}`}
              aria-label={spec.name ?? spec.placeholder}
              defaultValue={value}
              name={spec.name}
              placeholder={spec.placeholder}
              type={spec.type ?? 'text'}
            />
          )
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitSheet',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['openVariable'],
          properties: {
            openVariable: { type: 'string' },
            title: { type: 'string' },
            side: { enum: ['left', 'right', 'top', 'bottom'] },
            width: { type: 'number' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          const spec = resource.spec as SheetSpec
          const open = Boolean(ctx.variables.get(spec.openVariable))
          // Unmount entirely when closed — the variable is the single source
          // of truth, so we skip the exit animation rather than track it.
          if (!open) return null
          return (
            <Sheet open onOpenChange={(next) => !next && ctx.variables.set(spec.openVariable, undefined)}>
              <SheetContent
                side={spec.side ?? 'right'}
                style={spec.width ? { width: spec.width, maxWidth: spec.width } : undefined}
                className="flex flex-col gap-0 p-0"
              >
                <SheetHeader className="border-b px-4 py-3">
                  <SheetTitle className="text-sm font-semibold">{spec.title}</SheetTitle>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto">{ctx.slots.children()}</div>
              </SheetContent>
            </Sheet>
          )
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitRecord',
        recordScope: true,
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['data'],
          properties: {
            data: { type: 'object' },
            variables: { type: 'array' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (_resource, ctx) => <>{ctx.slots.children()}</>,
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitForm',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['submit'],
          properties: {
            submit: {
              type: 'object',
              additionalProperties: false,
              required: ['mutation'],
              properties: {
                action: { type: 'string' },
                mutation: { type: 'object' },
                onSuccess: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'variable'],
                    properties: {
                      kind: { const: 'setVariable' },
                      variable: { type: 'string' },
                      from: { type: 'string' },
                    },
                  },
                },
              },
            },
            submitLabel: { type: 'string' },
            successMessage: { type: 'string' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => <ResourceForm spec={resource.spec as FormSpec} ctx={ctx} />,
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'GridKitTable',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          required: ['data'],
          properties: {
            title: { type: 'string' },
            data: { type: 'object' },
            columns: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  label: { type: 'string' },
                  type: { enum: ['text', 'number', 'date', 'boolean'] },
                  align: { enum: ['left', 'center', 'right'] },
                  flex: { type: 'number' },
                  emphasis: { enum: ['strong'] },
                  tone: { enum: ['muted'] },
                  display: { enum: ['badge'] },
                  variant: { type: 'string' },
                  map: { type: 'object', additionalProperties: { type: 'string' } },
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
        render: (resource, ctx) => {
          const spec = resource.spec as GridTableSpec
          return <ResourceDataGrid spec={spec} ctx={ctx} />
        },
      },
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
          return <KitFilterInput config={spec.config} value={value} onChange={(nextValue: unknown) => ctx.events.emit('change', { value: nextValue })} />
        },
      },
    ],
  }
}
