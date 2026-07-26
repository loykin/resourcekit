import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../core/registry'
import { createMemoryRuntimeStore, runtimeKeys } from '../runtime/store'
import type { DataResolver, Resource } from '../core/types'
import { ResourceRenderer } from './ResourceRenderer'
import type { KindRenderFn, RenderContext } from './types'

describe('ResourceRenderer', () => {
  it('retains only the latest variable fingerprint for each direct data binding', async () => {
    let captured: RenderContext | undefined
    const resolve = vi.fn(async () => [])
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'cache',
      dataResolvers: { search: resolve },
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          render: (_resource, ctx) => {
            captured = ctx
            return createElement('div')
          },
        },
      ],
    })
    const binding = { source: 'search', query: '${query}' }
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Probe',
      spec: {},
      variables: [{ name: 'query', default: 'a' }],
    }
    renderToStaticMarkup(createElement(ResourceRenderer, { registry, resource }))

    await captured?.data.resolve(binding)
    captured?.variables.set('query', 'b')
    await captured?.data.resolve(binding)
    captured?.variables.set('query', 'a')
    await captured?.data.resolve(binding)

    expect(resolve).toHaveBeenCalledTimes(3)
  })

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
      spec: {},
      variables: [{ name: 'customerId', default: 'c1' }],
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

  it('resolves an inline data binding parameterized by a page variable', async () => {
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

    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Probe',
      spec: {},
      variables: [{ name: 'selectedCluster', default: 'cluster-a' }],
    }

    renderToStaticMarkup(createElement(ResourceRenderer, { resource, registry }))

    const binding = { source: 'metrics', request: { cluster: '${selectedCluster}' } }
    await expect(captured?.data.resolve(binding)).resolves.toEqual([{ cluster: 'cluster-a', cpu: 72 }])
    captured?.variables.set('selectedCluster', 'cluster-b')
    await expect(captured?.data.resolve(binding)).resolves.toEqual([{ cluster: 'cluster-b', cpu: 72 }])
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('publishes a resource event payload into a page variable', async () => {
    let captured: RenderContext | undefined
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          behaviorPolicy: { events: { select: { kind: 'setVariable', variable: 'selection', from: 'row.id' } } },
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
      spec: {},
      variables: [{ name: 'selection' }],
    }

    renderToStaticMarkup(createElement(ResourceRenderer, { resource, registry }))
    captured?.events.emit('select', { row: { id: 'cluster-a' } })

    expect(captured?.variables.get('selection')).toBe('cluster-a')
  })

  it('forwards a scoped host action without interpreting adapter-owned semantics', async () => {
    let captured: RenderContext | undefined
    const handled = vi.fn(async () => undefined)
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ActionProbe',
          specSchema: { type: 'object' },
          behaviorPolicy: { events: { activate: { kind: 'action', action: 'pipelines.open' } } },
          render: (_resource, ctx) => {
            captured = ctx
            return createElement('div')
          },
        },
      ],
    })
    const scope = registry.scope({ actions: { allow: ['pipelines.open'] } })

    renderToStaticMarkup(
      createElement(ResourceRenderer, {
        resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'ActionProbe', spec: {} },
        registry: scope,
        onAction: handled,
      }),
    )
    captured?.events.emit('activate', { id: 'pipeline-7' })

    await vi.waitFor(() =>
      expect(handled).toHaveBeenCalledWith({
        scope: 'document',
        action: 'pipelines.open',
        resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'ActionProbe', spec: {} },
        payload: { id: 'pipeline-7' },
      }),
    )
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
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'ControlledProbe',
      objectState: [
        { name: 'selected', initialValue: 'a' },
        { name: 'rows', initialValue: [{ id: 'a' }] },
      ],
      bindings: { selected: { $state: 'selected' }, rows: { $state: 'rows' } },
      spec: {},
    }

    renderToStaticMarkup(createElement(ResourceRenderer, { resource, registry }))
    await expect(captured?.bindings.read('selected')).resolves.toBe('a')
    await captured?.bindings.write('selected', 'b')
    await expect(captured?.bindings.read('selected')).resolves.toBe('b')
    await expect(captured?.bindings.write('rows', [])).rejects.toThrow('not writable')
  })

  it('writes through a binding path update only that field, not the whole node (docs/dataflow-and-server-state-direction.md)', async () => {
    let captured: RenderContext | undefined
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'FormProbe',
          specSchema: { type: 'object' },
          bindingPolicy: { inputs: { command: { description: 'Draft command field', writable: true } } },
          render: (_resource, ctx) => {
            captured = ctx
            return createElement('div', null, 'probe')
          },
        },
      ],
    })
    const runtimeStore = createMemoryRuntimeStore()
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'FormProbe',
      objectState: [{ name: 'draft', initialValue: { command: 'old', name: 'nginx' } }],
      bindings: { command: { $state: 'draft', path: 'command' } },
      spec: {},
    }

    renderToStaticMarkup(createElement(ResourceRenderer, { resource, registry, runtimeStore, runtimeScope: 'document' }))
    await expect(captured?.bindings.read('command')).resolves.toBe('old')

    await captured?.bindings.write('command', 'nginx -g daemon off;')

    await expect(captured?.bindings.read('command')).resolves.toBe('nginx -g daemon off;')
    expect(runtimeStore.read(runtimeKeys.objectState('draft', 'document'))?.value).toEqual({
      command: 'nginx -g daemon off;',
      name: 'nginx',
    })
  })

  // Coverage for a policy-bearing, coordinator-routed dataflow unit
  // requires real effects (the DataflowEngine's declare-time fetch, wired
  // in a useEffect) — renderToStaticMarkup never runs effects, so that
  // case lives in ResourceRenderer.render.test.ts's coordinator tests
  // instead, which already use @testing-library/react's render()/act().
})
