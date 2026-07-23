// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../../core/registry'
import { ResourceRenderer } from '../../react'
import type { KindRenderFn } from '../../react'
import { staticResolver } from '../../connection/resolvers'
import { createDesignKitPlugin } from './plugin'

afterEach(cleanup)

describe('DesignKit forms', () => {
  it('preserves repeated FormData names as an array', async () => {
    const mutation = vi.fn(async (_binding, payload) => payload)
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationResolvers: { memory: mutation } })

    // Two fields sharing `name: 'roles'` used to also share the same React
    // key (`key={field.name}`), which React flags as a duplicate-key error
    // during reconciliation — assert it doesn't fire alongside the FormData
    // behavior below.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'FormView',
          spec: {
            sections: [
              {
                id: 'roles',
                fields: [
                  { name: 'roles', label: 'Admin', type: 'checkbox', defaultValue: 'admin' },
                  { name: 'roles', label: 'Editor', type: 'checkbox', defaultValue: 'editor' },
                ],
              },
            ],
            submitLabel: 'Save roles',
            submit: { mutation: { target: 'memory' } },
          },
        },
      }),
    )

    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Save roles' }))

    await waitFor(() => expect(mutation).toHaveBeenCalled())
    expect(mutation.mock.calls[0][1]).toEqual({ roles: ['admin', 'editor'] })
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('two children with the same key'), expect.anything())
    consoleError.mockRestore()
  })
})

describe('DesignKit form submit placement', () => {
  it('renders the given id on the ResourceForm <form> element', () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())

    const { container } = render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ResourceForm',
          spec: { id: 'user-form', submit: { mutation: { target: 'memory' } } },
        },
      }),
    )

    expect(container.querySelector('form')?.id).toBe('user-form')
  })

  it('suppresses the built-in submit button when hideSubmitButton is set', () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'FormView',
          spec: {
            id: 'user-form',
            hideSubmitButton: true,
            sections: [{ id: 's', fields: [{ name: 'username' }] }],
            submit: { mutation: { target: 'memory' } },
          },
        },
      }),
    )

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})

describe('DesignKit Textarea/Checkbox/Select kinds', () => {
  it('Textarea prefills from fieldRef and submits its value through ResourceForm', async () => {
    const mutation = vi.fn(async (_binding, payload) => payload)
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationResolvers: { memory: mutation }, dataResolvers: { static: staticResolver } })

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'RecordScope',
          spec: { data: { source: 'static', rows: [{ notes: 'line one\nline two' }] } },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ResourceForm',
                  spec: { submit: { mutation: { target: 'memory' } } },
                  slots: [
                    {
                      items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Textarea', spec: { name: 'notes', fieldRef: 'notes' } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    )

    const textarea = (await screen.findByLabelText('notes')) as HTMLTextAreaElement
    expect(textarea.value).toBe('line one\nline two')

    fireEvent.change(textarea, { target: { value: 'edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mutation).toHaveBeenCalled())
    expect(mutation.mock.calls[0][1]).toEqual({ notes: 'edited' })
  })

  it('Checkbox prefills a single boolean field from fieldRef and submits its checked value', async () => {
    const mutation = vi.fn(async (_binding, payload) => payload)
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationResolvers: { memory: mutation }, dataResolvers: { static: staticResolver } })

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'RecordScope',
          spec: { data: { source: 'static', rows: [{ active: true }] } },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ResourceForm',
                  spec: { submit: { mutation: { target: 'memory' } } },
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'Checkbox',
                          spec: { name: 'active', label: 'Active', value: 'true', fieldRef: 'active' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    )

    const checkbox = await screen.findByRole('checkbox')
    expect(checkbox.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mutation).toHaveBeenCalled())
    expect(mutation.mock.calls[0][1]).toEqual({ active: 'true' })
  })

  it('Checkbox prefills checked state via array membership for a checkbox-group field', async () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', dataResolvers: { static: staticResolver } })

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'RecordScope',
          spec: { data: { source: 'static', rows: [{ roles: ['admin', 'viewer'] }] } },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DataBodyGroup',
                  spec: {},
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'Checkbox',
                          spec: { name: 'roles', label: 'Admin', value: 'admin', fieldRef: 'roles' },
                        },
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'Checkbox',
                          spec: { name: 'roles', label: 'Editor', value: 'editor', fieldRef: 'roles' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    )

    const [admin, editor] = await screen.findAllByRole('checkbox')
    expect(admin.getAttribute('aria-checked')).toBe('true')
    expect(editor.getAttribute('aria-checked')).toBe('false')
  })

  it('Select prefills from fieldRef and submits the chosen option through ResourceForm', async () => {
    const mutation = vi.fn(async (_binding, payload) => payload)
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationResolvers: { memory: mutation }, dataResolvers: { static: staticResolver } })

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'RecordScope',
          spec: { data: { source: 'static', rows: [{ concurrencyPolicy: 'Allow' }] } },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ResourceForm',
                  spec: { submit: { mutation: { target: 'memory' } } },
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'Select',
                          spec: {
                            name: 'concurrencyPolicy',
                            fieldRef: 'concurrencyPolicy',
                            options: [
                              { label: 'Allow', value: 'Allow' },
                              { label: 'Forbid', value: 'Forbid' },
                              { label: 'Replace', value: 'Replace' },
                            ],
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    )

    const select = (await screen.findByLabelText('concurrencyPolicy')) as HTMLSelectElement
    expect(select.value).toBe('Allow')

    fireEvent.change(select, { target: { value: 'Forbid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mutation).toHaveBeenCalled())
    expect(mutation.mock.calls[0][1]).toEqual({ concurrencyPolicy: 'Forbid' })
  })
})

describe('DesignKit adapter parity', () => {
  it('exposes public status, section, and flexible workbench placement contracts', () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())

    const dataBody = registry.getKind('resourcekit.dev/v1alpha1', 'DataBody')
    const workbench = registry.getKind('resourcekit.dev/v1alpha1', 'Workbench')
    const panel = registry.getKind('resourcekit.dev/v1alpha1', 'Panel')
    const panelSection = registry.getKind('resourcekit.dev/v1alpha1', 'PanelSection')
    const dataBodyField = registry.getKind('resourcekit.dev/v1alpha1', 'DataBodyField')

    expect(dataBody?.slotPolicy?.slots?.status?.accepts).toEqual(['Badge'])
    expect(workbench?.slotPolicy?.slots?.status?.accepts).toEqual(['Badge'])
    expect(workbench?.slotPolicy?.slots?.mainPane?.acceptsLevels).toEqual(['organism', 'leaf'])
    expect(workbench?.slotPolicy?.slots?.bottomPane?.acceptsLevels).toEqual(['organism', 'leaf'])
    expect(panel?.slotPolicy?.slots?.status?.accepts).toEqual(['Badge'])
    expect(panelSection?.level).toEqual(['organism'])
    expect(dataBodyField?.slotPolicy?.defaultSlot?.accepts).toEqual(['Badge', 'ActionButton'])
  })

  it('passes required and disabled through to the rendered InputControl element', () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'InputControl',
          spec: { name: 'username', required: true, disabled: true },
        },
      }),
    )

    const input = screen.getByLabelText('username') as HTMLInputElement
    expect(input.required).toBe(true)
    expect(input.disabled).toBe(true)
  })

  it('emits live InputControl changes through the resource event policy', () => {
    const onEvent = vi.fn()
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())

    render(
      createElement(ResourceRenderer, {
        registry,
        onEvent,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'InputControl',
          spec: {
            name: 'query',
            events: { change: { kind: 'emit', event: 'queryChanged' } },
          },
        },
      }),
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'query' }), { target: { value: 'resourcekit' } })
    expect(onEvent).toHaveBeenCalledWith('queryChanged', { value: 'resourcekit' })
  })
})
