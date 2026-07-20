import { useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import {
  Badge,
  Button,
  DataBodyTemplate,
  Input,
  ListDetailBodyTemplate,
  PageTopBar,
  PanelTemplate,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  WorkbenchBodyTemplate,
} from '@loykin/designkit'
import { getValueAtPath } from '../../path'
import type { ResourceKitPlugin, SubmitSpec } from '../../types'
import { SUBMIT_CANCELLED } from '../../submit'
import type { KindRenderFn, RenderContext } from '../../react'
import { useBindingValue } from '../internal/bindings'
import { withKindAliases } from '../internal/shared'
import { submitSpecSchema } from '../internal/submitSchema'

interface ListDetailSpec {
  listWidth?: number
}

interface WorkbenchSpec {
  title?: string
  description?: string
  leftPaneWidth?: number
  rightPaneWidth?: number
  bottomPaneHeight?: number
  minLeftPaneWidth?: number
  maxLeftPaneWidth?: number
  minRightPaneWidth?: number
  maxRightPaneWidth?: number
  minBottomPaneHeight?: number
  maxBottomPaneHeight?: number
  resizable?: boolean
  leftPaneCollapsed?: boolean
  rightPaneCollapsed?: boolean
  bottomPaneCollapsed?: boolean
}

interface DataBodySpec {
  title?: string
  description?: string
  defaultTab?: string
  status?: string
}

interface PageTopBarSpec {
  left?: string
  variant?: 'ghost' | 'default'
  height?: string
  sidebarTrigger?: boolean
}

interface DataBodyBodySpec {
  className?: string
}

interface DataBodyTabSpec {
  id: string
  label: string
  count?: number
  disabled?: boolean
}

interface DataBodySectionSpec {
  id: string
  label: string
  description?: string
  disabled?: boolean
}

interface DataBodySummarySpec {
  className?: string
}

interface DataBodyGroupSpec {
  title?: string
  description?: string
  layout?: string
  variant?: string
  danger?: boolean
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
  /** Dot-path into the nearest record scope (ctx.record). */
  fieldRef?: string
}

interface PanelSpec {
  title?: string
  eyebrow?: string
}

interface PanelSectionSpec {
  title?: string
  description?: string
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
  /** Dot-path into the nearest record scope — prefills the input. */
  fieldRef?: string
}

interface FormSpec {
  submit: SubmitSpec
  submitLabel?: string
  successMessage?: string
}

interface FormViewFieldSpec {
  name: string
  label?: string
  type?: string
  required?: boolean
  placeholder?: string
  defaultValue?: string
  /** Dot-path into the nearest record scope — prefills the input, like InputControl.fieldRef. */
  fieldRef?: string
}

interface FormViewSectionSpec {
  id: string
  label?: string
  description?: string
  fields: FormViewFieldSpec[]
}

interface FormViewSpec {
  sections: FormViewSectionSpec[]
  submit: SubmitSpec
  submitLabel?: string
  successMessage?: string
}

interface SheetSpec {
  title?: string
  side?: 'left' | 'right' | 'top' | 'bottom'
  width?: number
}

const KitBadge = Badge as ComponentType<Record<string, unknown>>
const KitButton = Button as ComponentType<Record<string, unknown>>
const KitDataBody = DataBodyTemplate as ComponentType<Record<string, unknown>>
const KitDataBodyGroup = DataBodyTemplate.Group as ComponentType<Record<string, unknown>>
const KitDataBodyRow = DataBodyTemplate.Row as unknown as ComponentType<Record<string, unknown>>
const KitDataBodyField = DataBodyTemplate.Field as unknown as ComponentType<Record<string, unknown>>
const KitInput = Input as ComponentType<Record<string, unknown>>
const KitListDetail = ListDetailBodyTemplate as unknown as ComponentType<Record<string, unknown>>
const KitPageTopBar = PageTopBar as ComponentType<Record<string, unknown>>
const KitPanel = PanelTemplate as ComponentType<Record<string, unknown>>
const KitPanelSection = PanelTemplate.Section as ComponentType<Record<string, unknown>>
const KitWorkbench = WorkbenchBodyTemplate as ComponentType<Record<string, unknown>>
const KitDataBodyBody = DataBodyTemplate.Body as ComponentType<Record<string, unknown>>
const KitDataBodyTab = DataBodyTemplate.Tab as unknown as ComponentType<Record<string, unknown>>
const KitDataBodySection = DataBodyTemplate.Section as unknown as ComponentType<Record<string, unknown>>
const KitDataBodySummary = DataBodyTemplate.Summary as ComponentType<Record<string, unknown>>

function dataBodyChildren(ctx: RenderContext): ReactNode {
  const entries = ctx.slots.entries()
  if (entries.length === 0) return ctx.slots.children()

  return entries.map(({ resource, node }, index) => {
    if (resource.kind === 'DataBodyBody' || resource.kind === 'DesignKitDataBodyBody') {
      const spec = resource.spec as DataBodyBodySpec
      return (
        <KitDataBodyBody key={`${resource.kind}-${index}`} className={spec.className}>
          {node}
        </KitDataBodyBody>
      )
    }
    if (resource.kind === 'DataBodyTab' || resource.kind === 'DesignKitDataBodyTab') {
      const spec = resource.spec as DataBodyTabSpec
      return (
        <KitDataBodyTab key={`${resource.kind}-${index}`} id={spec.id} label={spec.label} count={spec.count} disabled={spec.disabled}>
          {node}
        </KitDataBodyTab>
      )
    }
    if (resource.kind === 'DataBodySection' || resource.kind === 'DesignKitDataBodySection') {
      const spec = resource.spec as DataBodySectionSpec
      return (
        <KitDataBodySection
          key={`${resource.kind}-${index}`}
          id={spec.id}
          label={spec.label}
          description={spec.description}
          disabled={spec.disabled}
        >
          {node}
        </KitDataBodySection>
      )
    }
    if (resource.kind === 'DataBodySummary' || resource.kind === 'DesignKitDataBodySummary') {
      const spec = resource.spec as DataBodySummarySpec
      return (
        <KitDataBodySummary key={`${resource.kind}-${index}`} className={spec.className}>
          {node}
        </KitDataBodySummary>
      )
    }
    return node
  })
}

function ListDetailNode({ spec, ctx }: { spec: ListDetailSpec; ctx: RenderContext }) {
  const selection = useBindingValue(ctx, 'selection')
  const hasSelectionSource = ctx.bindings.has('selection')
  const emptyDetail = ctx.slots.one('emptyDetail')
  const clearSelection = hasSelectionSource
    ? () => {
        void ctx.bindings.write('selection', undefined)
      }
    : undefined

  return (
    <KitListDetail
      topBar={ctx.slots.one('topBar')}
      list={ctx.slots.requiredOne('list')}
      detail={emptyDetail && !selection ? undefined : ctx.slots.one('detail')}
      emptyDetail={emptyDetail}
      listWidth={spec.listWidth}
      onBack={clearSelection}
    />
  )
}

function DataBodyFieldNode({ spec, ctx }: { spec: DataBodyFieldSpec; ctx: RenderContext }) {
  const boundValue = useBindingValue(ctx, 'value', spec.value)
  const fieldValue = spec.fieldRef !== undefined ? getValueAtPath(ctx.record, spec.fieldRef) : undefined
  const value = fieldValue ?? boundValue
  return (
    <KitDataBodyField label={spec.label} description={spec.description}>
      {ctx.slots.children() ?? (value == null ? null : String(value))}
    </KitDataBodyField>
  )
}

function InputNode({ spec, ctx }: { spec: InputSpec; ctx: RenderContext }) {
  const boundValue = useBindingValue(ctx, 'value', spec.value)
  const fieldValue = spec.fieldRef !== undefined ? getValueAtPath(ctx.record, spec.fieldRef) : undefined
  const raw = fieldValue ?? boundValue
  const value = raw == null ? undefined : String(raw)
  return (
    <KitInput
      key={`${spec.name ?? ''}:${value ?? ''}`}
      aria-label={spec.name ?? spec.placeholder}
      className="w-full min-w-[16rem]"
      defaultValue={value}
      name={spec.name}
      placeholder={spec.placeholder}
      style={{ minWidth: 256, width: '100%' }}
      type={spec.type ?? 'text'}
      onChange={(event: { currentTarget: { value: string } }) => ctx.events.emit('change', { value: event.currentTarget.value })}
    />
  )
}

function SheetNode({ spec, ctx }: { spec: SheetSpec; ctx: RenderContext }) {
  const open = Boolean(useBindingValue(ctx, 'open'))
  if (!open) return null
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (next) return
        void ctx.bindings.write('open', undefined)
      }}
    >
      <SheetContent
        side={spec.side ?? 'right'}
        style={spec.width ? { width: spec.width, maxWidth: spec.width } : undefined}
        className="flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="text-sm font-semibold">{spec.title}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{ctx.slots.children()}</div>
      </SheetContent>
    </Sheet>
  )
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
        const payload = collectFormPayload(new FormData(event.currentTarget))
        setBusy(true)
        setMessage(undefined)
        ctx.actions
          .submit(spec.submit, payload)
          .then((result) => {
            if (result !== SUBMIT_CANCELLED) setMessage({ tone: 'ok', text: spec.successMessage ?? 'Saved' })
          })
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
 * Flattened form kind: sections of named fields declared directly in `spec`,
 * with no nested DataBodySection/DataBodyRow/InputControl tree required.
 * Submits the same way as ResourceForm.
 */
function FormView({ spec, ctx }: { spec: FormViewSpec; ctx: RenderContext }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>()

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const payload = collectFormPayload(new FormData(event.currentTarget))
        setBusy(true)
        setMessage(undefined)
        ctx.actions
          .submit(spec.submit, payload)
          .then((result) => {
            if (result !== SUBMIT_CANCELLED) setMessage({ tone: 'ok', text: spec.successMessage ?? 'Saved' })
          })
          .catch((error: unknown) =>
            setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Submit failed' }),
          )
          .finally(() => setBusy(false))
      }}
    >
      {spec.sections.map((section) => (
        <div key={section.id} className="border-b border-border px-4 py-4 last:border-b-0">
          {section.label && <h3 className="mb-1 text-sm font-medium">{section.label}</h3>}
          {section.description && <p className="mb-3 text-xs text-muted-foreground">{section.description}</p>}
          <div className="grid gap-3">
            {section.fields.map((field, fieldIndex) => {
              const fieldValue = field.fieldRef !== undefined ? getValueAtPath(ctx.record, field.fieldRef) : undefined
              const defaultValue = fieldValue == null ? field.defaultValue : String(fieldValue)
              return (
                // Repeated `name` is a deliberately supported pattern now (a
                // checkbox group posting multiple values under one field
                // name) — `field.name` alone is no longer a safe React key.
                <label key={`${field.name}-${fieldIndex}`} className="grid gap-1 text-sm">
                  {field.label && <span className="text-muted-foreground">{field.label}</span>}
                  <KitInput
                    name={field.name}
                    type={field.type ?? 'text'}
                    required={field.required}
                    placeholder={field.placeholder}
                    defaultValue={defaultValue}
                  />
                </label>
              )
            })}
          </div>
        </div>
      ))}
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

function collectFormPayload(formData: FormData): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const payload: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {}
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key)
    payload[key] = values.length === 1 ? values[0] : values
  }
  return payload
}

const formViewFieldSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    type: { type: 'string' },
    required: { type: 'boolean' },
    placeholder: { type: 'string' },
    defaultValue: { type: 'string' },
    fieldRef: { type: 'string' },
  },
}

const formViewSectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'fields'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    description: { type: 'string' },
    fields: { type: 'array', items: formViewFieldSchema },
  },
}

/**
 * Data-bound grid: resolves the binding through the runtime, infers columns,
 * then applies declarative ColumnHint presentation. Re-resolves when a
 * `${var}` referenced by the binding changes.
 */
export function createDesignKitPlugin(): ResourceKitPlugin<KindRenderFn> {
  return withKindAliases(
  {
    name: 'designkit-adapter',
    kinds: [
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitPageTopBar',
        level: ['organism'],
        description:
          'Page header bar with a left-aligned title and an optional right-aligned slot for controls. Always nested inside a template — never a document root.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            left: { type: 'string' },
            variant: { enum: ['ghost', 'default'] },
            height: { type: 'string' },
            sidebarTrigger: { type: 'boolean' },
          },
        },
        slotPolicy: {
          slots: {
            right: {
              min: 0,
              accepts: ['FilterControl', 'ActionButton'],
              description: 'Controls rendered at the right edge of the top bar, e.g. a filter or search control.',
            },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as PageTopBarSpec
          return (
            <KitPageTopBar
              left={spec.left}
              right={ctx.slots.one('right')}
              variant={spec.variant}
              height={spec.height}
              sidebarTrigger={spec.sidebarTrigger === false ? false : undefined}
            />
          )
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitListDetail',
        level: ['template'],
        description:
          'Two-pane browse layout: a selectable list on the left, a detail view on the right that shows the selected record. Use for record-browsing/CRM-style screens.',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            listWidth: { type: 'number' },
            variables: { type: 'array' },
          },
        },
        slotPolicy: {
          slots: {
            topBar: {
              min: 0,
              max: 1,
              accepts: ['PageTopBar'],
              description: 'Header bar for the whole list/detail screen.',
            },
            list: {
              min: 1,
              max: 1,
              accepts: ['SelectableList'],
              description:
                'The selectable list of records (required) — must be SelectableList. The list pane is a fixed-width, non-scrolling rail, so wide multi-column views like TableView/GridKitTable don\'t fit here; use those in a Workbench mainPane instead.',
            },
            detail: {
              min: 0,
              max: 1,
              accepts: ['DetailView', 'RecordScope', 'DataBody', 'Panel'],
              description:
                'The detail view for the currently selected record — typically DetailView, or RecordScope wrapping a DataBody for more elaborate composition.',
            },
            emptyDetail: {
              min: 0,
              max: 1,
              accepts: ['Panel'],
              description: 'Shown in the detail pane instead of `detail` when nothing is selected yet.',
            },
          },
        },
        bindingPolicy: {
          inputs: {
            selection: {
              description: 'Currently selected record ID shared by the list and detail composition.',
              schema: { type: 'string' },
              writable: true,
            },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as ListDetailSpec
          return <ListDetailNode spec={spec} ctx={ctx} />
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitWorkbench',
        level: ['template'],
        description:
          'Resizable multi-pane workspace layout (like an IDE): optional side/bottom panes around one required main pane. Use for data-tool screens where the user works across several regions at once (filters, a primary table/editor, an inspector).',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            leftPaneWidth: { type: 'number' },
            rightPaneWidth: { type: 'number' },
            bottomPaneHeight: { type: 'number' },
            minLeftPaneWidth: { type: 'number' },
            maxLeftPaneWidth: { type: 'number' },
            minRightPaneWidth: { type: 'number' },
            maxRightPaneWidth: { type: 'number' },
            minBottomPaneHeight: { type: 'number' },
            maxBottomPaneHeight: { type: 'number' },
            resizable: { type: 'boolean' },
            leftPaneCollapsed: { type: 'boolean' },
            rightPaneCollapsed: { type: 'boolean' },
            bottomPaneCollapsed: { type: 'boolean' },
          },
        },
        slotPolicy: {
          slots: {
            topBar: {
              min: 0,
              max: 1,
              accepts: ['Panel', 'PageTopBar'],
              description: 'Header bar for the whole workbench.',
            },
            headerRight: {
              min: 0,
              acceptsLevels: ['organism', 'leaf'],
              description: 'Controls rendered at the right of the header, alongside topBar.',
            },
            actions: {
              min: 0,
              acceptsLevels: ['organism', 'leaf'],
              description: 'Primary action buttons for the workbench, typically near the header.',
            },
            leftPane: {
              min: 0,
              max: 1,
              acceptsLevels: ['organism', 'leaf'],
              description: 'Secondary content to the left of mainPane — typically filters, navigation, or a list.',
            },
            mainPane: {
              min: 1,
              max: 1,
              acceptsLevels: ['organism', 'leaf'],
              description: 'The primary content of the workbench (required) — the main table, editor, or view the user works in.',
            },
            rightPane: {
              min: 0,
              max: 1,
              acceptsLevels: ['organism', 'leaf'],
              description:
                'Secondary content to the right of mainPane — typically an inspector, detail panel, or contextual info for the current selection.',
            },
            bottomPane: {
              min: 0,
              max: 1,
              acceptsLevels: ['organism', 'leaf'],
              description: 'Secondary content below mainPane — typically a chart, log, or console tied to the main content.',
            },
            status: {
              min: 0,
              max: 1,
              accepts: ['Badge'],
              description: 'Compact status shown in the workbench header.',
            },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as WorkbenchSpec
          return (
            <KitWorkbench
              topBar={ctx.slots.one('topBar')}
              title={spec.title}
              description={spec.description}
              status={ctx.slots.one('status')}
              headerRight={ctx.slots.one('headerRight')}
              actions={ctx.slots.one('actions')}
              leftPane={ctx.slots.one('leftPane')}
              mainPane={ctx.slots.requiredOne('mainPane')}
              rightPane={ctx.slots.one('rightPane')}
              bottomPane={ctx.slots.one('bottomPane')}
              leftPaneWidth={spec.leftPaneWidth}
              rightPaneWidth={spec.rightPaneWidth}
              bottomPaneHeight={spec.bottomPaneHeight}
              minLeftPaneWidth={spec.minLeftPaneWidth}
              maxLeftPaneWidth={spec.maxLeftPaneWidth}
              minRightPaneWidth={spec.minRightPaneWidth}
              maxRightPaneWidth={spec.maxRightPaneWidth}
              minBottomPaneHeight={spec.minBottomPaneHeight}
              maxBottomPaneHeight={spec.maxBottomPaneHeight}
              resizable={spec.resizable}
              leftPaneCollapsed={spec.leftPaneCollapsed}
              rightPaneCollapsed={spec.rightPaneCollapsed}
              bottomPaneCollapsed={spec.bottomPaneCollapsed}
            />
          )
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitDataBody',
        level: ['template', 'organism'],
        description:
          'Labeled body of structured content (forms, summaries, tabbed data). Can be the whole document (a settings/detail page) or nested inside another template\'s slot (e.g. a Workbench mainPane or a ListDetail detail pane) as that region\'s content. Its own content goes through DataBodyGroup/DataBodySection/DataBodyTab/DataBodySummary.',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            defaultTab: { type: 'string' },
            status: { type: 'string' },
          },
        },
        slotPolicy: {
          defaultSlot: {
            min: 0,
            accepts: [
              'DataBodyGroup',
              'DataBodySummary',
              'DataBodyTab',
              'DataBodySection',
              'DataBodyBody',
              'ChartView',
              'ResourceForm',
              'FormView',
              'DetailView',
              'TableView',
              'Sheet',
            ],
            description:
              'The body content — DataBodyGroup/DataBodySection/DataBodyTab/DataBodySummary to organize it, or content kinds directly (e.g. DetailView, FormView, ChartView).',
          },
          slots: {
            topBar: {
              min: 0,
              max: 1,
              accepts: ['PageTopBar'],
              description: 'Header bar for this content body.',
            },
            actions: {
              min: 0,
              accepts: ['ActionButton'],
              description: 'Primary action buttons for this content body.',
            },
            toolbarLeft: {
              min: 0,
              max: 1,
              accepts: ['FilterControl'],
              description: 'Toolbar controls left-aligned above the body content.',
            },
            toolbarRight: {
              min: 0,
              acceptsLevels: ['organism', 'leaf'],
              description: 'Toolbar controls right-aligned above the body content.',
            },
            status: {
              min: 0,
              max: 1,
              accepts: ['Badge'],
              description: 'Compact status shown next to the DataBody heading.',
            },
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
              {dataBodyChildren(ctx)}
            </KitDataBody>
          )
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitDataBodyBody',
        level: ['organism'],
        description:
          'Groups a chunk of DataBody content under one visual block with no label of its own. Use when content does not need a title/id, unlike DataBodySection or DataBodyTab.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            className: { type: 'string' },
          },
        },
        slotPolicy: {
          defaultSlot: { min: 0, acceptsLevels: ['organism', 'leaf'], description: 'Content wrapped by this block.' },
        },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitDataBodyTab',
        level: ['organism'],
        description:
          'One tab of a tabbed DataBody, switching its content in and out with sibling DataBodyTab kinds. Use when content should be organized as tabs the user switches between, not all visible at once — contrast with DataBodySection, where every section stays visible together.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            count: { type: 'number' },
            disabled: { type: 'boolean' },
          },
        },
        slotPolicy: {
          defaultSlot: {
            min: 0,
            accepts: ['TableView', 'ChartView', 'DataBodyGroup'],
            description: 'Content shown when this tab is active.',
          },
        },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitDataBodySection',
        level: ['organism'],
        description:
          'A labeled, always-visible section of a DataBody (e.g. a settings form\'s "General" section). Use when content should be visible all at once under its own heading — contrast with DataBodyTab, whose content is switched, not co-visible.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            description: { type: 'string' },
            disabled: { type: 'boolean' },
          },
        },
        slotPolicy: {
          defaultSlot: {
            min: 0,
            accepts: ['DataBodyRow', 'DataBodyGroup'],
            description: 'Content belonging to this section.',
          },
        },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitDataBodySummary',
        level: ['organism'],
        description:
          'A compact summary band at the top of a DataBody, typically DataBodyGroup wrapping key-metric DataBodyField entries (e.g. a dashboard status strip). Use for at-a-glance metrics, not the main content.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            className: { type: 'string' },
          },
        },
        slotPolicy: {
          defaultSlot: {
            min: 0,
            accepts: ['DataBodyGroup'],
            description: 'The summary content, typically DataBodyGroup wrapping DataBodyField entries.',
          },
        },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitDataBodyGroup',
        level: ['organism'],
        description:
          'Groups related DataBodyRow/DataBodyField entries under an optional title with layout/variant styling (e.g. a card or an inline strip). The field-organizing unit inside a DataBody, DataBodySection, or DataBodyTab — not a page-level container.',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            layout: { type: 'string' },
            variant: { type: 'string' },
            danger: { type: 'boolean' },
          },
        },
        slotPolicy: {
          defaultSlot: {
            min: 0,
            accepts: ['ObjectFields', 'DataBodyField', 'DataBodyRow', 'SelectableList', 'DetailView'],
            description:
              'The rows or fields belonging to this group. A split-layout group may instead pair SelectableList with DetailView.',
          },
          slots: {
            actions: {
              min: 0,
              accepts: ['ActionButton'],
              description: 'Actions shown in the group header.',
            },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as DataBodyGroupSpec
          return (
            <KitDataBodyGroup
              title={spec.title}
              description={spec.description}
              layout={spec.layout}
              variant={spec.variant}
              danger={spec.danger}
              actions={ctx.slots.one('actions')}
            >
              {ctx.slots.children()}
            </KitDataBodyGroup>
          )
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitDataBodyRow',
        level: ['organism'],
        description:
          'One labeled row inside a DataBodyGroup, pairing a label with an input control (a form field row). For read-only key/value display with no input, use DataBodyField directly instead.',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            label: { type: 'string' },
            description: { type: 'string' },
            required: { type: 'boolean' },
          },
        },
        slotPolicy: {
          defaultSlot: {
            min: 0,
            accepts: ['InputControl'],
            description: 'The control for this row, typically InputControl.',
          },
        },
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
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitDataBodyField',
        level: ['organism'],
        description:
          'A read-only labeled value display (label + value), for showing data rather than collecting it. Use bindings.value for shared runtime state, or value/fieldRef for local literals and record scope.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['label'],
          properties: {
            label: { type: 'string' },
            description: { type: 'string' },
            value: { type: 'string', description: 'A literal value to display.' },
            fieldRef: { type: 'string', description: 'Display this dot-path from the nearest record scope (e.g. inside a RecordScope).' },
          },
        },
        slotPolicy: {
          defaultSlot: {
            min: 0,
            accepts: ['Badge', 'ActionButton'],
            description: 'Optional override content instead of the plain text value, e.g. a Badge or field-level action.',
          },
        },
        bindingPolicy: {
          inputs: {
            value: { description: 'Value displayed by this field.', schema: {} },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as DataBodyFieldSpec
          return <DataBodyFieldNode spec={spec} ctx={ctx} />
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitPanel',
        level: ['organism'],
        description:
          'A titled card for grouping arbitrary content — the general-purpose container when none of the more specific templates (DataBody, ListDetail, Workbench) fit. Not root-eligible; always nested inside another template\'s slot.',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            title: { type: 'string' },
            eyebrow: { type: 'string' },
          },
        },
        slotPolicy: {
          defaultSlot: { min: 0, acceptsLevels: ['organism', 'leaf'], description: 'The panel\'s content.' },
          slots: {
            status: {
              min: 0,
              max: 1,
              accepts: ['Badge'],
              description: 'Compact status shown in the panel header.',
            },
            actions: {
              min: 0,
              accepts: ['ActionButton'],
              description: 'Action controls in the panel header, next to the title.',
            },
            footer: { min: 0, max: 1, acceptsLevels: ['organism', 'leaf'], description: 'Content pinned to the bottom of the panel.' },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as PanelSpec
          return (
            <KitPanel
              title={spec.title}
              eyebrow={spec.eyebrow}
              status={ctx.slots.one('status')}
              actions={ctx.slots.one('actions')}
              footer={ctx.slots.one('footer')}
            >
              {ctx.slots.children()}
            </KitPanel>
          )
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitPanelSection',
        level: ['organism'],
        description: 'A labeled section inside a Panel, with optional section actions.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
          },
        },
        slotPolicy: {
          defaultSlot: {
            min: 0,
            acceptsLevels: ['organism', 'leaf'],
            description: 'Section content.',
          },
          slots: {
            actions: {
              min: 0,
              accepts: ['ActionButton'],
              description: 'Actions shown in the section header.',
            },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as PanelSectionSpec
          return (
            <KitPanelSection title={spec.title} description={spec.description} actions={ctx.slots.one('actions')}>
              {ctx.slots.children()}
            </KitPanelSection>
          )
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitText',
        level: ['leaf'],
        description: 'Plain static text.',
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
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitBadge',
        level: ['leaf'],
        description: 'A small colored label for status/category, e.g. "Active" or "Prospect".',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          required: ['label'],
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
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitButton',
        level: ['leaf'],
        description: 'A clickable button. Its `value` is included in the emitted click event payload.',
        specSchema: {
          type: 'object',
          additionalProperties: true,
          required: ['label'],
          properties: {
            label: { type: 'string' },
            value: { type: 'string', description: 'Included as `value` in the click event payload emitted on click.' },
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
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitInput',
        level: ['leaf'],
        description:
          'A text input control. Use bindings.value for shared runtime state, or value/fieldRef for a literal or record-scoped prefill. For a group of inputs submitted together, wrap them in DesignKitForm.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            placeholder: { type: 'string' },
            type: { type: 'string' },
            value: { type: 'string', description: 'A literal prefill value.' },
            fieldRef: { type: 'string', description: 'Prefill from this dot-path into the nearest record scope.' },
            events: { type: 'object' },
          },
        },
        bindingPolicy: {
          inputs: {
            value: { description: 'Current input value.', schema: {} },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as InputSpec
          return <InputNode spec={spec} ctx={ctx} />
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitSheet',
        level: ['organism'],
        description:
          'A slide-in overlay panel (drawer/modal), shown while its writable `open` binding is truthy and closed by clearing that binding. Use for secondary/transient content (e.g. a create/edit form triggered from a button) — not root-eligible, always attached to a triggering page.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            side: { enum: ['left', 'right', 'top', 'bottom'] },
            width: { type: 'number' },
          },
        },
        slotPolicy: {
          defaultSlot: { min: 0, accepts: ['ResourceForm'], description: "The sheet's content." },
        },
        bindingPolicy: {
          inputs: {
            open: { description: 'Whether the sheet is open.', schema: { type: 'boolean' }, writable: true },
          },
        },
        render: (resource, ctx) => {
          const spec = resource.spec as SheetSpec
          return <SheetNode spec={spec} ctx={ctx} />
        },
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitRecord',
        level: ['organism'],
        description:
          'Fetches one record via `data` and publishes it as the record scope for descendants (fieldRef lookups resolve against it). Wrap detail content (e.g. a DataBody) in this when it should read from a single fetched record rather than page variables directly.',
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
        slotPolicy: {
          defaultSlot: {
            min: 0,
            accepts: ['DataBody', 'ResourceForm'],
            description: 'Content that reads from the fetched record via fieldRef.',
          },
        },
        render: (_resource, ctx) => <>{ctx.slots.children()}</>,
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitForm',
        level: ['organism'],
        description:
          "A native form: collects its input controls' values on submit and dispatches them through the declarative `submit` mutation. Form state stays local until submit. Use when inputs should be submitted together as one action, unlike an individual InputControl connected through bindings.value.",
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['submit'],
          properties: {
            submit: submitSpecSchema,
            submitLabel: { type: 'string' },
            successMessage: { type: 'string' },
          },
        },
        slotPolicy: {
          defaultSlot: {
            min: 0,
            accepts: ['DataBodySection', 'DataBodyGroup', 'DataBodyRow', 'InputControl'],
            description: "The form's fields, typically DataBodySection/DataBodyRow/InputControl.",
          },
        },
        render: (resource, ctx) => <ResourceForm spec={resource.spec as FormSpec} ctx={ctx} />,
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'DesignKitFormView',
        level: ['organism', 'template'],
        description:
          'A flattened form: sections of named input fields plus a submit binding, declared directly in `spec` with no nested DataBodySection/DataBodyRow/InputControl tree. Use for simple settings/edit forms — for per-field composition (badges, custom controls), use ResourceForm instead.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['sections', 'submit'],
          properties: {
            sections: { type: 'array', items: formViewSectionSchema },
            submit: submitSpecSchema,
            submitLabel: { type: 'string' },
            successMessage: { type: 'string' },
          },
        },
        render: (resource, ctx) => <FormView spec={resource.spec as FormViewSpec} ctx={ctx} />,
      },
    ],
  },
  [
    ['DesignKitPageTopBar', 'PageTopBar'],
    ['DesignKitListDetail', 'ListDetail'],
    ['DesignKitWorkbench', 'Workbench'],
    ['DesignKitDataBody', 'DataBody'],
    ['DesignKitDataBodyBody', 'DataBodyBody'],
    ['DesignKitDataBodyTab', 'DataBodyTab'],
    ['DesignKitDataBodySection', 'DataBodySection'],
    ['DesignKitDataBodySummary', 'DataBodySummary'],
    ['DesignKitDataBodyGroup', 'DataBodyGroup'],
    ['DesignKitDataBodyRow', 'DataBodyRow'],
    ['DesignKitDataBodyField', 'DataBodyField'],
    ['DesignKitPanel', 'Panel'],
    ['DesignKitPanelSection', 'PanelSection'],
    ['DesignKitText', 'Text'],
    ['DesignKitBadge', 'Badge'],
    ['DesignKitButton', 'ActionButton'],
    ['DesignKitInput', 'InputControl'],
    ['DesignKitSheet', 'Sheet'],
    ['DesignKitRecord', 'RecordScope'],
    ['DesignKitForm', 'ResourceForm'],
    ['DesignKitFormView', 'FormView'],
  ],
  )
}
