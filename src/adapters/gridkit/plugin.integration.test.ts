// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../../registry'
import { ResourceRenderer } from '../../react'
import { staticResolver } from '../../resolvers'
import type { KindRenderFn } from '../../react'
import { createGridKitPlugin } from './plugin'

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GridKitTable row actions with the real GridKit component', () => {
  it('renders, confirms, mutates, emits its effect, and does not select the row', async () => {
    const mutation = vi.fn(async () => ({ id: '7', name: 'Ada' }))
    const confirm = vi.fn(async () => true)
    const onEvent = vi.fn()
    const registry = createRegistry<KindRenderFn>()
    registry.use(createGridKitPlugin())
    registry.use({ name: 'runtime', dataResolvers: { static: staticResolver }, mutationResolvers: { memory: mutation } })

    render(
      createElement(ResourceRenderer, {
        registry,
        confirmDialog: confirm,
        onEvent,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'GridKitTable',
          spec: {
            data: { source: 'static', rows: [{ id: '7', name: 'Ada', role: 'Editor' }] },
            events: { rowSelect: { kind: 'emit', event: 'selected' } },
            columns: {
              name: { label: 'Name' },
              actions: {
                label: '',
                display: 'actions',
                items: [
                  {
                    id: 'delete',
                    label: 'Delete',
                    submit: {
                      mutation: { target: 'memory', id: '${payload.id}' },
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
    await waitFor(() => expect(onEvent).toHaveBeenCalledWith('deleted', { id: '7', name: 'Ada' }))

    expect(confirm).toHaveBeenCalledWith({ title: 'Delete Ada?' })
    expect(mutation).toHaveBeenCalledWith({ target: 'memory', id: '7' }, { id: '7', name: 'Ada', role: 'Editor' }, { variables: {} })
    expect(onEvent).not.toHaveBeenCalledWith('selected', expect.anything())
  })
})
