// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../../core/registry'
import { ResourceRenderer } from '../../react'
import { staticResolver } from '../../dataflow/resolvers'
import type { KindRenderFn } from '../../react'
import { createGridKitPlugin } from './plugin'

const API_VERSION = 'resourcekit.dev/v1alpha1'

vi.mock('@loykin/gridkit', () => ({
  DataGrid: ({ data, columns, onRowClick }: { data: Record<string, unknown>[]; columns: Array<Record<string, unknown>>; onRowClick?: (row: unknown) => void }) =>
    createElement(
      'table',
      null,
      createElement(
        'tbody',
        null,
        data.map((original, rowIndex) =>
          createElement(
            'tr',
            { key: rowIndex, onClick: () => onRowClick?.({ original }) },
            columns.map((column, columnIndex) => {
              const cell = column.cell as ((context: unknown) => unknown) | undefined
              const value = typeof column.accessorFn === 'function' ? (column.accessorFn as (row: Record<string, unknown>) => unknown)(original) : original[column.accessorKey as string]
              return createElement('td', { key: columnIndex }, cell ? (cell({ getValue: () => value, row: { original } }) as ReactNode) : String(value ?? ''))
            }),
          ),
        ),
      ),
    ),
  DataGridPaginationCompact: () => null,
  GlobalSearch: () => null,
  inferTablePayload: () => ({ columns: [] }),
}))

afterEach(cleanup)

describe('GridKit guide contracts', () => {
  it('exposes controlled server pagination and sorting on TableView', () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createGridKitPlugin())

    const table = registry.getKind(API_VERSION, 'TableView')
    const schema = table?.specSchema as {
      properties?: Record<string, { properties?: Record<string, unknown> }>
    }

    expect(schema.properties?.pagination?.properties).toMatchObject({
      pageSize: expect.any(Object),
      pageIndex: expect.any(Object),
      pageCount: expect.any(Object),
      totalCount: expect.any(Object),
      pageSizes: expect.any(Object),
    })
    expect(table?.bindingPolicy?.inputs).toMatchObject({
      pageIndex: { writable: true },
      pageCount: expect.any(Object),
      totalCount: expect.any(Object),
      sorting: { writable: true },
    })
  })

  it('exposes the constrained CardCollection vocabulary used by publishing and commerce guides', () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createGridKitPlugin())

    const cards = registry.getKind(API_VERSION, 'CardCollection')
    const schema = cards?.specSchema as {
      required?: string[]
      properties?: Record<string, unknown>
    }

    expect(schema.required).toEqual(['data', 'titleField'])
    expect(schema.properties).toMatchObject({
      idField: expect.any(Object),
      titleField: expect.any(Object),
      subtitleField: expect.any(Object),
      descriptionField: expect.any(Object),
      imageField: expect.any(Object),
      statusField: expect.any(Object),
    })
  })
})

describe('GridKitTable row actions', () => {
  it('submits the complete SubmitSpec with row payload and stops row-click propagation', async () => {
    const mutation = vi.fn(async () => ({ ok: true }))
    const confirm = vi.fn(async () => true)
    const onEvent = vi.fn()
    const registry = createRegistry<KindRenderFn>()
    registry.use(createGridKitPlugin())
    registry.use({
      name: 'runtime',
      dataSourceManifests: [{ apiVersion: API_VERSION, kind: 'static', resolve: staticResolver }],
      mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: mutation }],
    })

    render(
      createElement(ResourceRenderer, {
        registry,
        confirmDialog: confirm,
        onEvent,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'GridKitTable',
          events: { rowSelect: { kind: 'emit', event: 'selected' } },
          spec: {
            data: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [{ id: '7', name: 'Ada' }] } },
            columns: {
              name: { label: 'Name' },
              actions: {
                display: 'actions',
                items: [
                  {
                    id: 'delete',
                    label: 'Delete',
                    submit: {
                      mutation: { apiVersion: API_VERSION, kind: 'memory', spec: { id: '${payload.id}' } },
                      confirm: { title: 'Delete ${payload.name}?' },
                      onSuccess: [{ kind: 'emit', event: 'deleted' }],
                    },
                  },
                ],
              },
            },
          },
        },
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mutation).toHaveBeenCalled())

    expect(confirm).toHaveBeenCalledWith({ title: 'Delete Ada?' })
    expect(mutation).toHaveBeenCalledWith(
      { apiVersion: API_VERSION, kind: 'memory', spec: { id: '7' } },
      { id: '7', name: 'Ada' },
      { variables: {} },
    )
    expect(onEvent).toHaveBeenCalledWith('deleted', { ok: true })
    expect(onEvent).not.toHaveBeenCalledWith('selected', expect.anything())
  })

  it('hides and disables actions from row-derived conditions', async () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createGridKitPlugin())
    registry.use({ name: 'runtime', dataSourceManifests: [{ apiVersion: API_VERSION, kind: 'static', resolve: staticResolver }] })

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'GridKitTable',
          spec: {
            data: {
              apiVersion: API_VERSION,
              kind: 'static',
              spec: {
                rows: [
                  { id: '1', name: 'Admin', role: 'Admin' },
                  { id: '2', name: 'Viewer', role: 'Viewer' },
                ],
              },
            },
            columns: {
              name: { label: 'Name' },
              actions: {
                display: 'actions',
                items: [
                  { id: 'edit', label: 'Edit', event: 'edit', hideWhen: { field: 'role', equals: 'Viewer' } },
                  { id: 'delete', label: 'Delete', event: 'delete', disabledWhen: { field: 'role', equals: 'Admin' } },
                ],
              },
            },
          },
        },
      }),
    )

    const adminRow = (await screen.findByText('Admin')).closest('tr')
    const viewerRow = screen.getByText('Viewer').closest('tr')
    expect(adminRow).toBeTruthy()
    expect(viewerRow).toBeTruthy()
    expect(within(adminRow!).getByRole('button', { name: 'Delete' }).hasAttribute('disabled')).toBe(true)
    expect(within(adminRow!).getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(within(viewerRow!).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(viewerRow!).getByRole('button', { name: 'Delete' }).hasAttribute('disabled')).toBe(false)
  })
})
