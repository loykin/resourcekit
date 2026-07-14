import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../registry'
import type { ResourceDocument } from '../dataflow'
import type { DataResolver, Resource } from '../types'
import { ResourceRenderer } from './ResourceRenderer'
import type { KindRenderFn, RenderContext } from './types'

describe('ResourceRenderer', () => {
  it('renders resources recursively through slot accessors', () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          specSchema: { type: 'object' },
          slotPolicy: { defaultSlot: { min: 0 }, slots: { aside: { min: 0 } } },
          render: (_resource, ctx) =>
            createElement('section', null, createElement('main', null, ctx.slots.children()), createElement('aside', null, ctx.slots.one('aside'))),
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Text',
          specSchema: { type: 'object' },
          render: (resource) => createElement('span', null, (resource.spec as { text: string }).text),
        },
      ],
    })

    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Panel',
      spec: {},
      slots: [
        { items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', spec: { text: 'Body' } }] },
        { name: 'aside', items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', spec: { text: 'Aside' } }] },
      ],
    }

    expect(renderToStaticMarkup(createElement(ResourceRenderer, { resource, registry }))).toBe(
      '<section><main><span>Body</span></main><aside><span>Aside</span></aside></section>',
    )
  })

  it('exposes slot entries with rendered child nodes', () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'List',
          specSchema: { type: 'object' },
          slotPolicy: { defaultSlot: { min: 0 } },
          render: (_resource, ctx) =>
            createElement(
              'ul',
              null,
              ctx.slots.entries().map((entry) => createElement('li', { key: entry.resource.kind }, entry.node)),
            ),
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Text',
          specSchema: { type: 'object' },
          render: (resource) => createElement('span', null, (resource.spec as { text: string }).text),
        },
      ],
    })

    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'List',
      spec: {},
      slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', spec: { text: 'Entry' } }] }],
    }

    expect(renderToStaticMarkup(createElement(ResourceRenderer, { resource, registry }))).toBe('<ul><li><span>Entry</span></li></ul>')
  })

  it('degrades unknown kinds to the fallback node only', () => {
    const registry = createRegistry<KindRenderFn>()
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Missing',
      spec: {},
    }

    expect(
      renderToStaticMarkup(
        createElement(ResourceRenderer, {
          resource,
          registry,
          renderUnknownKind: (unknown) => createElement('div', null, `Unknown:${unknown.kind}`),
        }),
      ),
    ).toBe('<div>Unknown:Missing</div>')
  })

  it('interpolates data bindings and invalidates only bindings touched by changed variables', async () => {
    let captured: RenderContext | undefined
    const resolver: DataResolver = vi.fn(async (binding) => [{ url: (binding as { url: string }).url }])
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'test',
      dataResolvers: { rest: resolver },
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          behaviorPolicy: { events: { select: { kind: 'setVariable', variable: 'customerId', from: 'row.id' } } },
          render: (_resource, ctx) => {
            captured = ctx
            return createElement('div', null, 'probe')
          },
        },
      ],
    })

    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Probe',
      spec: { variables: [{ name: 'customerId', default: 'c1' }] },
    }

    renderToStaticMarkup(createElement(ResourceRenderer, { resource, registry }))

    await expect(captured?.data.resolve({ source: 'rest', url: '/api/customers/${customerId}' })).resolves.toEqual([
      { url: '/api/customers/c1' },
    ])
    await captured?.data.resolve({ source: 'rest', url: '/api/customers/${customerId}' })
    expect(resolver).toHaveBeenCalledTimes(1)

    captured?.events.emit('select', { row: { id: 'c2' } })
    await expect(captured?.data.resolve({ source: 'rest', url: '/api/customers/${customerId}' })).resolves.toEqual([
      { url: '/api/customers/c2' },
    ])
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('applies data binding valuePath after resolver output', async () => {
    let captured: RenderContext | undefined
    const resolver: DataResolver = vi.fn(async () => [{ payload: { customer: { id: 'c1', name: 'Ada' } } }])
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'test',
      dataResolvers: { static: resolver },
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          render: (_resource, ctx) => {
            captured = ctx
            return createElement('div', null, 'probe')
          },
        },
      ],
    })

    renderToStaticMarkup(createElement(ResourceRenderer, { resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Probe', spec: {} }, registry }))

    await expect(captured?.data.resolve({ source: 'static', rows: [], valuePath: 'payload.customer' })).resolves.toEqual([
      { id: 'c1', name: 'Ada' },
    ])
  })

  it('renders a ResourceDocument and resolves inline data references through existing resolvers', async () => {
    let captured: RenderContext | undefined
    const resolver: DataResolver = vi.fn(async (binding) => {
      const request = (binding as { request: { cluster: string } }).request
      return [{ cluster: request.cluster, cpu: 72 }]
    })
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'test',
      dataResolvers: { metrics: resolver },
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          render: (_resource, ctx) => {
            captured = ctx
            return createElement('div', null, 'probe')
          },
        },
      ],
    })

    const document: ResourceDocument = {
      data: {
        nodes: {
          selectedCluster: { kind: 'state', initialValue: 'cluster-a' },
          metrics: {
            kind: 'resolve',
            binding: { source: 'metrics', request: { cluster: { $data: 'selectedCluster' } } },
          },
        },
      },
      resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Probe', spec: {} },
    }

    renderToStaticMarkup(createElement(ResourceRenderer, { resource: document, registry }))

    await expect(captured?.data.resolve({ $data: 'metrics' })).resolves.toEqual([{ cluster: 'cluster-a', cpu: 72 }])
    await captured?.data.set('selectedCluster', 'cluster-b')
    await expect(captured?.data.resolve({ $data: 'metrics' })).resolves.toEqual([{ cluster: 'cluster-b', cpu: 72 }])
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('publishes a resource event payload into a document state node', async () => {
    let captured: RenderContext | undefined
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          behaviorPolicy: { events: { select: { kind: 'setData', node: 'selection', from: 'row' } } },
          render: (_resource, ctx) => {
            captured = ctx
            return createElement('div', null, 'probe')
          },
        },
      ],
    })
    const document: ResourceDocument = {
      data: { nodes: { selection: { kind: 'state' } } },
      resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Probe', spec: {} },
    }

    renderToStaticMarkup(createElement(ResourceRenderer, { resource: document, registry }))
    captured?.events.emit('select', { row: { id: 'cluster-a' } })

    await vi.waitFor(async () => {
      await expect(captured?.data.resolve({ $data: 'selection' })).resolves.toEqual([{ id: 'cluster-a' }])
    })
  })

  it('exposes kind-declared bindings through the central document store', async () => {
    let captured: RenderContext | undefined
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ControlledProbe',
          specSchema: { type: 'object' },
          bindingPolicy: {
            inputs: {
              selected: { description: 'Selected ID', writable: true },
              rows: { description: 'Read-only rows' },
            },
          },
          render: (_resource, ctx) => {
            captured = ctx
            return createElement('div', null, 'probe')
          },
        },
      ],
    })
    const document: ResourceDocument = {
      data: { nodes: { selected: { kind: 'state', initialValue: 'a' }, rows: { kind: 'state', initialValue: [{ id: 'a' }] } } },
      resource: {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'ControlledProbe',
        bindings: { selected: { $data: 'selected' }, rows: { $data: 'rows' } },
        spec: {},
      },
    }

    renderToStaticMarkup(createElement(ResourceRenderer, { resource: document, registry }))
    await expect(captured?.bindings.read('selected')).resolves.toBe('a')
    await captured?.bindings.write('selected', 'b')
    await expect(captured?.bindings.read('selected')).resolves.toBe('b')
    await expect(captured?.bindings.write('rows', [])).rejects.toThrow('not writable')
  })
})
