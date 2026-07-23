import { describe, expect, it } from 'vitest'
import { createRegistry } from '../../core/registry'
import { staticResolver } from '../../connection/resolvers'
import { validateResource } from '../../core/validation'
import type { Resource, ResourceKitPlugin } from '../../core/types'
import type { KindRenderFn } from '../../react'
import { composeResourceKitPlugins, createFirstPartyResourceAdapters } from './kits'

describe('createFirstPartyResourceAdapters', () => {
  it('keeps resolver maps when composing child plugins', async () => {
    const dataResolver = async () => [{ id: '1' }]
    const mutationResolver = async (_binding: unknown, payload: unknown) => payload
    const plugin = composeResourceKitPlugins('composed', [
      {
        name: 'child',
        kinds: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Probe', specSchema: { type: 'object' } }],
        dataResolvers: { custom: dataResolver },
        mutationResolvers: { custom: mutationResolver },
      },
    ])

    expect(plugin.kinds?.map((kind) => kind.kind)).toEqual(['Probe'])
    await expect(plugin.dataResolvers?.custom({ source: 'custom' }, { variables: {} })).resolves.toEqual([{ id: '1' }])
    await expect(plugin.mutationResolvers?.custom({ target: 'custom' }, { ok: true }, { variables: {} })).resolves.toEqual({ ok: true })
  })

  it('builds the first-party adapter set', () => {
    const plugin = createFirstPartyResourceAdapters() as ResourceKitPlugin<KindRenderFn>
    expect(plugin.kinds?.length).toBeGreaterThan(0)
  })
})

describe('flattened list/detail and form views (test.md §4)', () => {
  function firstPartyRegistry() {
    const registry = createRegistry()
    registry.use(createFirstPartyResourceAdapters())
    registry.use({ name: 'resolvers', dataResolvers: { static: staticResolver } })
    return registry
  }

  it('validates a ListDetail document using the flattened SelectableList/DetailView pair', () => {
    const registry = firstPartyRegistry()
    const doc: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'ListDetail',
      bindings: { selection: { $variable: 'customerId' } },
      spec: { title: 'Customers', variables: [{ name: 'customerId', default: '1' }] },
      slots: [
        {
          name: 'list',
          items: [
            {
              apiVersion: 'resourcekit.dev/v1alpha1',
              kind: 'SelectableList',
              spec: {
                data: { source: 'static', rows: [{ id: '1', name: 'Acme', status: 'active' }] },
                primary: { field: 'name' },
                secondary: [{ field: 'status' }],
              },
            },
          ],
        },
        {
          name: 'detail',
          items: [
            {
              apiVersion: 'resourcekit.dev/v1alpha1',
              kind: 'DetailView',
              spec: {
                data: { source: 'static', rows: [{ id: '1', name: 'Acme', status: 'active', revenue: 120000 }] },
                fields: [
                  { field: 'name', label: 'Name' },
                  { field: 'status', label: 'Status', display: 'badge' },
                  { field: 'revenue', label: 'Revenue', display: 'number' },
                ],
              },
            },
          ],
        },
      ],
    }

    expect(validateResource(doc, registry)).toEqual({ valid: true, issues: [] })
  })

  it('validates a flattened FormView document', () => {
    const registry = firstPartyRegistry()
    const doc: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'FormView',
      spec: {
        sections: [
          {
            id: 'general',
            label: 'General',
            fields: [
              { name: 'name', label: 'Name', type: 'text', required: true },
              { name: 'slug', label: 'Slug', type: 'text' },
            ],
          },
        ],
        submit: {
          mutation: { target: 'rest', url: 'https://api.example.com/workspace', method: 'PATCH' },
        },
      },
    }

    expect(validateResource(doc, registry)).toEqual({ valid: true, issues: [] })
  })

  it('validates confirmable form and row-action submit schemas without external $defs', () => {
    const registry = firstPartyRegistry()
    const form: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'FormView',
      spec: {
        sections: [],
        submit: {
          mutation: { target: 'rest', url: '/api/users/${payload.id}', method: 'DELETE' },
          confirm: { title: 'Delete ${payload.name}?' },
        },
      },
    }
    const table: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'GridKitTable',
      spec: {
        data: { source: 'static', rows: [{ id: '1', name: 'Ada' }] },
        columns: {
          name: { label: 'Name' },
          actions: {
            display: 'actions',
            items: [
              {
                id: 'delete',
                label: 'Delete',
                submit: {
                  action: 'users.delete',
                  mutation: { target: 'rest', url: '/api/users/${payload.id}', method: 'DELETE' },
                  confirm: { title: 'Delete ${payload.name}?' },
                  onSuccess: [{ kind: 'invalidateData', nodes: ['users'] }],
                },
              },
            ],
          },
        },
      },
    }

    expect(validateResource(form, registry)).toEqual({ valid: true, issues: [] })
    expect(validateResource(table, registry)).toEqual({ valid: true, issues: [] })
  })

  it('rejects a DetailView missing the required fields array', () => {
    const registry = firstPartyRegistry()
    const result = validateResource({ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'DetailView', spec: {} }, registry)
    expect(result.valid).toBe(false)
  })
})
