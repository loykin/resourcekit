import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../registry'
import type { DataResolver, LoykinResource } from '../types'
import { ResourceRenderer } from './ResourceRenderer'
import type { KindRenderFn, RenderContext } from './types'

describe('ResourceRenderer', () => {
  it('renders resources recursively through slot accessors', () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          specSchema: { type: 'object' },
          slotPolicy: { defaultSlot: { min: 0 }, slots: { aside: { min: 0 } } },
          render: (_resource, ctx) =>
            createElement('section', null, createElement('main', null, ctx.slots.children()), createElement('aside', null, ctx.slots.one('aside'))),
        },
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Text',
          specSchema: { type: 'object' },
          render: (resource) => createElement('span', null, (resource.spec as { text: string }).text),
        },
      ],
    })

    const resource: LoykinResource = {
      apiVersion: 'loykin.dev/v1alpha1',
      kind: 'Panel',
      spec: {},
      slots: [
        { items: [{ apiVersion: 'loykin.dev/v1alpha1', kind: 'Text', spec: { text: 'Body' } }] },
        { name: 'aside', items: [{ apiVersion: 'loykin.dev/v1alpha1', kind: 'Text', spec: { text: 'Aside' } }] },
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
          apiVersion: 'loykin.dev/v1alpha1',
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
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Text',
          specSchema: { type: 'object' },
          render: (resource) => createElement('span', null, (resource.spec as { text: string }).text),
        },
      ],
    })

    const resource: LoykinResource = {
      apiVersion: 'loykin.dev/v1alpha1',
      kind: 'List',
      spec: {},
      slots: [{ items: [{ apiVersion: 'loykin.dev/v1alpha1', kind: 'Text', spec: { text: 'Entry' } }] }],
    }

    expect(renderToStaticMarkup(createElement(ResourceRenderer, { resource, registry }))).toBe('<ul><li><span>Entry</span></li></ul>')
  })

  it('degrades unknown kinds to the fallback node only', () => {
    const registry = createRegistry<KindRenderFn>()
    const resource: LoykinResource = {
      apiVersion: 'loykin.dev/v1alpha1',
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
          apiVersion: 'loykin.dev/v1alpha1',
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

    const resource: LoykinResource = {
      apiVersion: 'loykin.dev/v1alpha1',
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
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          render: (_resource, ctx) => {
            captured = ctx
            return createElement('div', null, 'probe')
          },
        },
      ],
    })

    renderToStaticMarkup(createElement(ResourceRenderer, { resource: { apiVersion: 'loykin.dev/v1alpha1', kind: 'Probe', spec: {} }, registry }))

    await expect(captured?.data.resolve({ source: 'static', rows: [], valuePath: 'payload.customer' })).resolves.toEqual([
      { id: 'c1', name: 'Ada' },
    ])
  })
})
