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
import type { KindRenderFn, RenderContext } from '../../react/types'
import { variableName, withKindAliases } from '../internal/shared'

interface ListDetailSpec {
  listWidth?: number
  selectionVariable?: string
}

interface WorkbenchSpec {
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
  /** @deprecated Use leftPaneWidth. */
  leftWidth?: number
  /** @deprecated Use rightPaneWidth. */
  rightWidth?: number
}

interface DataBodySpec {
  title?: string
  description?: string
  defaultTab?: string
  status?: ReactNode
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
}

interface DataBodySectionSpec {
  id: string
  label: string
  description?: string
}

interface DataBodySummarySpec {
  className?: string
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
        <KitDataBodyTab key={`${resource.kind}-${index}`} id={spec.id} label={spec.label} count={spec.count}>
          {node}
        </KitDataBodyTab>
      )
    }
    if (resource.kind === 'DataBodySection' || resource.kind === 'DesignKitDataBodySection') {
      const spec = resource.spec as DataBodySectionSpec
      return (
        <KitDataBodySection key={`${resource.kind}-${index}`} id={spec.id} label={spec.label} description={spec.description}>
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
export function createDesignKitPlugin(): ResourceKitPlugin<KindRenderFn> {
  return withKindAliases(
  {
    name: 'designkit-adapter',
    kinds: [
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'PageTopBar',
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
            right: { min: 0, max: 1 },
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
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitPageTopBar',
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
            right: { min: 0, max: 1 },
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
            leftWidth: { type: 'number', deprecated: true },
            rightWidth: { type: 'number', deprecated: true },
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
              leftPaneWidth={spec.leftPaneWidth ?? spec.leftWidth}
              rightPaneWidth={spec.rightPaneWidth ?? spec.rightWidth}
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
              {dataBodyChildren(ctx)}
            </KitDataBody>
          )
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DataBodyBody',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            className: { type: 'string' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitDataBodyBody',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            className: { type: 'string' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DataBodyTab',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            count: { type: 'number' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitDataBodyTab',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            count: { type: 'number' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DataBodySection',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            description: { type: 'string' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitDataBodySection',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            description: { type: 'string' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DataBodySummary',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            className: { type: 'string' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
        },
      },
      {
        apiVersion: 'loykin.dev/v1alpha1',
        kind: 'DesignKitDataBodySummary',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            className: { type: 'string' },
          },
        },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (resource, ctx) => {
          return <>{ctx.slots.children()}</>
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
    ],
  },
  [
    ['DesignKitListDetail', 'ListDetail'],
    ['DesignKitWorkbench', 'Workbench'],
    ['DesignKitDataBody', 'DataBody'],
    ['DesignKitDataBodyGroup', 'DataBodyGroup'],
    ['DesignKitDataBodyRow', 'DataBodyRow'],
    ['DesignKitDataBodyField', 'DataBodyField'],
    ['DesignKitPanel', 'Panel'],
    ['DesignKitText', 'Text'],
    ['DesignKitBadge', 'Badge'],
    ['DesignKitButton', 'ActionButton'],
    ['DesignKitInput', 'InputControl'],
    ['DesignKitSheet', 'Sheet'],
    ['DesignKitRecord', 'RecordScope'],
    ['DesignKitForm', 'ResourceForm'],
  ],
  )
}
