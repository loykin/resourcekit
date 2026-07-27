// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../../core/registry'
import { ResourceRenderer } from '../../react'
import type { KindRenderFn } from '../../react'
import { staticResolver } from '../../dataflow/resolvers'
import { createMemoryRuntimeStore, runtimeKeys } from '../../runtime/store'
import type { Resource } from '../../core/types'
import { createDesignKitPlugin } from './plugin'

const API_VERSION = 'resourcekit.dev/v1alpha1'

afterEach(cleanup)

describe('DesignKit forms', () => {
  it('submits repeated RHF checkbox names as an array', async () => {
    const mutation = vi.fn(async (_binding, payload) => payload)
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: mutation }] })

    // Two fields sharing `name: 'roles'` must still have distinct React keys
    // while React Hook Form groups their checked values under one field.
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
            submit: { mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } },
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

  it('uses RHF validation and does not dispatch an invalid required FormView', async () => {
    const mutation = vi.fn(async (_binding, payload) => payload)
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: mutation }] })

    const { container } = render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'FormView',
          spec: {
            sections: [{ id: 'main', fields: [{ name: 'command', label: 'Command', required: true }] }],
            submit: { mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } },
          },
        },
      }),
    )

    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(screen.getByText('Command is required')).toBeTruthy())
    expect(mutation).not.toHaveBeenCalled()
  })

  it('hydrates FormView from a writable draft binding, publishes edits, and submits the complete draft', async () => {
    const mutation = vi.fn(async (_binding, payload) => payload)
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: mutation }] })
    const runtimeStore = createMemoryRuntimeStore()
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'FormView',
      objectState: [
        {
          name: 'processDraft',
          initialValue: {
            identity: 'process-7',
            value: { command: 'nginx -g daemon off;', name: 'nginx' },
          },
        },
      ],
      bindings: { draft: { $state: 'processDraft' } },
      spec: {
        sections: [{ id: 'main', fields: [{ name: 'command', label: 'Command' }] }],
        draftPolicy: { syncDelayMs: 0 },
        submit: { action: 'process.update', mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } },
      },
    }

    render(createElement(ResourceRenderer, { registry, resource, runtimeStore, runtimeScope: 'form' }))

    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Command' }) as HTMLInputElement).value).toBe('nginx -g daemon off;'),
    )
    const input = screen.getByRole('textbox', { name: 'Command' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'nginx -t' } })

    await waitFor(async () => {
      expect(runtimeStore.read(runtimeKeys.objectState('processDraft', 'form'))?.value).toEqual({
        identity: 'process-7',
        value: { command: 'nginx -t', name: 'nginx' },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mutation).toHaveBeenCalled())
    expect(mutation.mock.calls[0][1]).toEqual({ command: 'nginx -t', name: 'nginx' })
  })

  it('preserves a dirty FormView draft when an unrelated external refresh arrives', async () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: async () => ({}) }] })
    const runtimeStore = createMemoryRuntimeStore()
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'FormView',
      objectState: [{ name: 'draft', initialValue: { identity: 'process-1', value: { command: 'initial' } } }],
      bindings: { draft: { $state: 'draft' } },
      spec: {
        sections: [{ id: 'main', fields: [{ name: 'command', label: 'Command' }] }],
        draftPolicy: { syncDelayMs: 1000 },
        submit: { mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } },
      },
    }

    render(createElement(ResourceRenderer, { registry, resource, runtimeStore, runtimeScope: 'form' }))
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Command' }) as HTMLInputElement).value).toBe('initial'),
    )
    const input = screen.getByRole('textbox', { name: 'Command' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'local edit' } })

    runtimeStore.publish(runtimeKeys.objectState('draft', 'form'), {
      status: 'ready',
      value: { identity: 'process-1', value: { command: 'server refresh' } },
      epoch: 99,
    })

    await waitFor(() => expect(input.value).toBe('local edit'))
  })

  it('resets a dirty FormView when the draft identity changes', async () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: async () => ({}) }] })
    const runtimeStore = createMemoryRuntimeStore()
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'FormView',
      objectState: [{ name: 'draft', initialValue: { identity: 'process-a', value: { command: 'command-a' } } }],
      bindings: { draft: { $state: 'draft' } },
      spec: {
        sections: [{ id: 'main', fields: [{ name: 'command', label: 'Command' }] }],
        submit: { mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } },
      },
    }

    render(createElement(ResourceRenderer, { registry, resource, runtimeStore, runtimeScope: 'form' }))
    const input = await screen.findByRole('textbox', { name: 'Command' }) as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('command-a'))
    fireEvent.change(input, { target: { value: 'dirty-a' } })

    runtimeStore.publish(runtimeKeys.objectState('draft', 'form'), {
      status: 'ready',
      value: { identity: 'process-b', value: { command: 'command-b' } },
      epoch: 100,
    })

    await waitFor(() => expect(input.value).toBe('command-b'))
  })

  it('keeps a malformed controlled draft error local to FormView', async () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: async () => ({}) }] })
    const runtimeStore = createMemoryRuntimeStore()
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'FormView',
      objectState: [{ name: 'draft', initialValue: { command: 'legacy-flat-draft' } }],
      bindings: { draft: { $state: 'draft' } },
      spec: {
        sections: [{ id: 'main', fields: [{ name: 'command', label: 'Command' }] }],
        submit: { mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } },
      },
    }

    render(createElement(ResourceRenderer, { registry, resource, runtimeStore, runtimeScope: 'form' }))

    expect(await screen.findByText('Draft binding must contain { identity: string, value: object }')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Command' })).toBeTruthy()
  })

  it('treats a null controlled draft as hydration readiness and accepts a later envelope', async () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: async () => ({}) }] })
    const runtimeStore = createMemoryRuntimeStore()
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'FormView',
      objectState: [{ name: 'draft', initialValue: null }],
      bindings: { draft: { $state: 'draft' } },
      spec: {
        sections: [{ id: 'main', fields: [{ name: 'command', label: 'Command' }] }],
        submit: { mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } },
      },
    }

    render(createElement(ResourceRenderer, { registry, resource, runtimeStore, runtimeScope: 'form' }))
    expect(screen.queryByText('Draft binding must contain { identity: string, value: object }')).toBeNull()

    runtimeStore.publish(runtimeKeys.objectState('draft', 'form'), {
      status: 'ready',
      value: { identity: 'process-1', value: { command: 'hydrated' } },
    })

    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Command' }) as HTMLInputElement).value).toBe('hydrated'),
    )
  })

  it('renders RHF pending/error state for a named submit action', async () => {
    const failure = new Error('update rejected')
    let rejectMutation: ((error: unknown) => void) | undefined
    const mutation = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectMutation = reject
        }),
    )
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: mutation }] })

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'FormView',
          spec: {
            sections: [{ id: 'main', fields: [{ name: 'command', label: 'Command' }] }],
            submit: { action: 'process.update', mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } },
          },
        },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true))

    rejectMutation?.(failure)
    await waitFor(() => expect(screen.getByText('update rejected')).toBeTruthy())
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
          spec: { id: 'user-form', submit: { mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } } },
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
            submit: { mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } },
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
    registry.use({ name: 'runtime', mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: mutation }], dataSourceManifests: [{ apiVersion: API_VERSION, kind: 'static', resolve: staticResolver }] })

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'RecordScope',
          spec: {},
          record: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [{ notes: 'line one\nline two' }] } },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ResourceForm',
                  spec: { submit: { mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } } },
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
    registry.use({ name: 'runtime', mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: mutation }], dataSourceManifests: [{ apiVersion: API_VERSION, kind: 'static', resolve: staticResolver }] })

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'RecordScope',
          spec: {},
          record: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [{ active: true }] } },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ResourceForm',
                  spec: { submit: { mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } } },
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
    registry.use({ name: 'runtime', dataSourceManifests: [{ apiVersion: API_VERSION, kind: 'static', resolve: staticResolver }] })

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'RecordScope',
          spec: {},
          record: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [{ roles: ['admin', 'viewer'] }] } },
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
    registry.use({ name: 'runtime', mutationSourceManifests: [{ apiVersion: API_VERSION, kind: 'memory', resolve: mutation }], dataSourceManifests: [{ apiVersion: API_VERSION, kind: 'static', resolve: staticResolver }] })

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'RecordScope',
          spec: {},
          record: { apiVersion: API_VERSION, kind: 'static', spec: { rows: [{ concurrencyPolicy: 'Allow' }] } },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ResourceForm',
                  spec: { submit: { mutation: { apiVersion: API_VERSION, kind: 'memory', spec: {} } } },
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
    const formView = registry.getKind('resourcekit.dev/v1alpha1', 'FormView')

    expect(dataBody?.slotPolicy?.slots?.status?.accepts).toEqual(['Badge'])
    expect(workbench?.slotPolicy?.slots?.status?.accepts).toEqual(['Badge'])
    expect(workbench?.slotPolicy?.slots?.mainPane?.acceptsLevels).toEqual(['organism', 'leaf'])
    expect(workbench?.slotPolicy?.slots?.bottomPane?.acceptsLevels).toEqual(['organism', 'leaf'])
    expect(panel?.slotPolicy?.slots?.status?.accepts).toEqual(['Badge'])
    expect(panelSection?.level).toEqual(['organism'])
    expect(dataBodyField?.slotPolicy?.defaultSlot?.accepts).toEqual(['Badge', 'ActionButton'])
    expect(formView?.bindingPolicy?.inputs.draft?.writable).toBe(true)
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
          spec: { name: 'query' },
          events: { change: { kind: 'emit', event: 'queryChanged' } },
        },
      }),
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'query' }), { target: { value: 'resourcekit' } })
    expect(onEvent).toHaveBeenCalledWith('queryChanged', { value: 'resourcekit' })
  })
})
