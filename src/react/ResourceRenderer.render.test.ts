// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient } from '@tanstack/query-core'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTanStackQueryCoordinator } from '../dataflow/coordinators/tanstack-query'
import { createDirectQueryCoordinator } from '../dataflow/coordinator'
import type { QueryCoordinator } from '../dataflow/coordinator'
import { createMemoryRuntimeStore, runtimeKeys } from '../runtime/store'
import { createRegistry } from '../core/registry'
import type { Resource } from '../core/types'
import { createResourceViewPlugin } from '../adapters'
import { ResourceRenderer } from './ResourceRenderer'
import type { KindRenderFn, RenderContext } from './types'

afterEach(cleanup)

function setup() {
  const renderCounts: Record<string, number> = {}
  const contexts: Record<string, RenderContext> = {}

  const registry = createRegistry<KindRenderFn>()
  registry.use({
    name: 'test',
    kinds: [
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Group',
        specSchema: { type: 'object' },
        slotPolicy: { defaultSlot: { min: 0 } },
        render: (_resource, ctx) => createElement('div', null, ctx.slots.children()),
      },
      {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'Probe',
        specSchema: { type: 'object' },
        bindingPolicy: { inputs: { value: { description: 'bound value', writable: true } } },
        render: (resource, ctx) => {
          const name = resource.metadata?.name ?? 'unknown'
          renderCounts[name] = (renderCounts[name] ?? 0) + 1
          contexts[name] = ctx
          return createElement('div', { 'data-testid': name }, name)
        },
      },
    ],
  })

  const resource: Resource = {
    apiVersion: 'resourcekit.dev/v1alpha1',
    kind: 'Group',
    spec: {},
    variables: [
      { name: 'shared', default: 'v1' },
      { name: 'a', default: '1' },
      { name: 'b', default: '1' },
    ],
    slots: [
      {
        items: [
          {
            apiVersion: 'resourcekit.dev/v1alpha1',
            kind: 'Probe',
            metadata: { name: 'probeA' },
            bindings: { value: { $variable: 'a' } },
            spec: {},
            events: { touch: { kind: 'setVariable', variable: 'shared', from: 'value' } },
          },
          {
            apiVersion: 'resourcekit.dev/v1alpha1',
            kind: 'Probe',
            metadata: { name: 'probeB' },
            bindings: { value: { $variable: 'b' } },
            spec: {},
          },
        ] satisfies Resource[],
      },
    ],
  }

  return { registry, resource, renderCounts, contexts }
}

describe('ResourceRenderer node-level re-render scoping', () => {
  it('re-renders only the resource whose own variable dependency changed', async () => {
    const { registry, resource, renderCounts, contexts } = setup()
    render(createElement(ResourceRenderer, { resource, registry }))
    await act(async () => {})

    expect(renderCounts.probeA).toBeGreaterThanOrEqual(1)
    expect(renderCounts.probeB).toBeGreaterThanOrEqual(1)
    const [countsBeforeA, countsBeforeB] = [renderCounts.probeA, renderCounts.probeB]

    await act(async () => {
      contexts.probeA.variables.set('a', '2')
    })

    expect(renderCounts.probeA).toBeGreaterThan(countsBeforeA)
    expect(renderCounts.probeB).toBe(countsBeforeB)

    const countsAfterFirstA = renderCounts.probeA
    await act(async () => {
      contexts.probeB.variables.set('b', '2')
    })

    expect(renderCounts.probeB).toBeGreaterThan(countsBeforeB)
    expect(renderCounts.probeA).toBe(countsAfterFirstA)
  })

  it('does not re-render resources that do not subscribe to a changed variable', async () => {
    const { registry, resource, renderCounts, contexts } = setup()
    render(createElement(ResourceRenderer, { resource, registry }))
    await act(async () => {})

    const [countsBeforeA, countsBeforeB] = [renderCounts.probeA, renderCounts.probeB]

    await act(async () => {
      contexts.probeA.events.emit('touch', { value: 'v2' })
    })

    expect(renderCounts.probeA).toBe(countsBeforeA)
    expect(renderCounts.probeB).toBe(countsBeforeB)
  })

  it('does not recreate document state when the host replaces its action callback', async () => {
    const { registry, resource, contexts } = setup()
    const first = vi.fn()
    const view = render(createElement(ResourceRenderer, {
      resource,
      registry,
      onAction: first,
    }))
    await act(async () => {})
    await act(async () => {
      contexts.probeA.variables.set('a', '2')
    })

    const second = vi.fn()
    view.rerender(createElement(ResourceRenderer, {
      resource,
      registry,
      onAction: second,
    }))
    await act(async () => {})

    expect(contexts.probeA.variables.get('a')).toBe('2')
  })
})

describe('RecordScopeNode refetches on a pure $state dependency change', () => {
  it('re-fetches the record when the underlying object-state slot changes with no ${variable} involved', async () => {
    let latestRecord: Record<string, unknown> | undefined
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'record-scope',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'RecordProbe',
          specSchema: { type: 'object' },
          recordScope: true,
          render: (_resource, ctx) => {
            latestRecord = ctx.record
            return createElement('div', null, JSON.stringify(ctx.record))
          },
        },
      ],
    })
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'RecordProbe',
      spec: {},
      objectState: [{ name: 'customer', initialValue: { name: 'Ada' } }],
      record: { $state: 'customer' },
    }
    const runtimeStore = createMemoryRuntimeStore()

    render(createElement(ResourceRenderer, { resource, registry, runtimeStore, runtimeScope: 'record-scope' }))
    await act(async () => {})
    expect(latestRecord).toEqual({ name: 'Ada' })

    // No ${variable} is involved in this binding at all — before the fix,
    // stateKey never changed for a pure $state binding, so this update never
    // re-triggered the record fetch and latestRecord stayed { name: 'Ada' }.
    await act(async () => {
      runtimeStore.publish(runtimeKeys.objectState('customer', 'record-scope'), { status: 'ready', value: { name: 'Bob' } })
    })

    expect(latestRecord).toEqual({ name: 'Bob' })
  })
})

describe('ResourceRenderer mutation-to-dataflow-engine integration', () => {
  it.each([
    ['direct', () => createDirectQueryCoordinator()],
    [
      'TanStack Query',
      () => createTanStackQueryCoordinator(new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })),
    ],
  ] satisfies Array<[string, () => QueryCoordinator]>)(
    'routes refetchData through the %s coordinator and exposes the fresh dataflow value',
    async (_name, createCoordinator) => {
    let context: RenderContext | undefined
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'before' }])
      .mockResolvedValueOnce([{ id: 'after' }])
    const registry = createRegistry<KindRenderFn>()
    registry.use(createResourceViewPlugin())
    registry.use({
      name: 'e2e',
      dataResolvers: { query },
      mutationResolvers: { memory: async () => ({ id: 'saved' }) },
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ActionProbe',
          specSchema: { type: 'object' },
          render: (_resource, ctx) => {
            context = ctx
            return createElement('button', null, 'Save')
          },
        },
      ],
    })
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'ActionProbe',
      dataflow: [{ name: 'rows', binding: { source: 'query' } }],
      spec: {},
    }

    const coordinator = createCoordinator()
    const invalidate = vi.spyOn(coordinator, 'invalidate')
    render(createElement(ResourceRenderer, {
      resource,
      registry,
      queryCoordinator: coordinator,
    }))
    await act(async () => {})
    expect(query).toHaveBeenCalledTimes(1)

    await act(async () => {
      await context?.actions.submit(
        {
          mutation: { target: 'memory' },
          onSuccess: [
            { kind: 'invalidateData', dataflow: ['rows'] },
            { kind: 'refetchData', dataflow: ['rows'] },
          ],
        },
        { draft: true },
      )
    })

    expect(invalidate).toHaveBeenCalledWith(['rows'])
    expect(query).toHaveBeenCalledTimes(2)
    await expect(context?.data.resolve({ $dataflow: 'rows' })).resolves.toEqual([{ id: 'after' }])
    },
  )
})

describe('DataflowEngine guards against out-of-order fetch completion', () => {
  it('ignores a stale fetch that settles after a newer one', async () => {
    let context: RenderContext | undefined
    const deferred: Array<(rows: Record<string, unknown>[]) => void> = []
    const query = vi.fn(() => new Promise<Record<string, unknown>[]>((resolve) => deferred.push(resolve)))
    const registry = createRegistry<KindRenderFn>()
    registry.use(createResourceViewPlugin())
    registry.use({
      name: 'race',
      dataResolvers: { query },
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ActionProbe',
          specSchema: { type: 'object' },
          render: (_resource, ctx) => {
            context = ctx
            return createElement('div', null, 'probe')
          },
        },
      ],
    })
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'ActionProbe',
      variables: [{ name: 'sel', default: 'a' }],
      dataflow: [{ name: 'rows', binding: { source: 'query', id: '${sel}' } }],
      spec: {},
    }
    const runtimeStore = createMemoryRuntimeStore()

    render(createElement(ResourceRenderer, { resource, registry, runtimeStore, runtimeScope: 'race' }))
    await act(async () => {})
    expect(query).toHaveBeenCalledTimes(1) // first fetch in flight for sel=a

    act(() => {
      runtimeStore.publish(runtimeKeys.variable('sel', 'race'), { status: 'ready', value: 'b' })
    })
    await act(async () => {})
    expect(query).toHaveBeenCalledTimes(2) // second fetch in flight for sel=b

    // Resolve out of order: the newer (sel=b) fetch settles first, then the
    // stale (sel=a) one settles after. Before the generation-counter fix,
    // the stale settle would overwrite the newer value.
    await act(async () => {
      deferred[1]([{ id: 'b' }])
    })
    await expect(context?.data.resolve({ $dataflow: 'rows' })).resolves.toEqual([{ id: 'b' }])

    await act(async () => {
      deferred[0]([{ id: 'a' }])
    })
    await expect(context?.data.resolve({ $dataflow: 'rows' })).resolves.toEqual([{ id: 'b' }])
  })
})

describe('ResourceRenderer visibility', () => {
  it('reactively hides a visible root when its page variable changes', async () => {
    let context: RenderContext | undefined
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'visibility',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          render: (_resource, ctx) => {
            context = ctx
            return createElement('div', { 'data-testid': 'root-probe' }, 'Visible')
          },
        },
      ],
    })
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Probe',
      visible: { $variable: 'roles', contains: 'admin' },
      spec: {},
      variables: [{ name: 'roles', type: 'string[]', default: ['admin'] }],
    }

    const view = render(createElement(ResourceRenderer, { resource, registry }))
    expect(view.queryByTestId('root-probe')).toBeTruthy()

    await act(async () => context?.variables.set('roles', []))
    expect(view.queryByTestId('root-probe')).toBeNull()
  })

  it('keeps slot children, entries, and resources on the same filtered set', async () => {
    let context: RenderContext | undefined
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'visibility',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Group',
          specSchema: { type: 'object' },
          slotPolicy: { slots: { content: { min: 0 } } },
          render: (_resource, ctx) => {
            context = ctx
            return createElement(
              'div',
              null,
              createElement('span', { 'data-testid': 'counts' }, `${ctx.slots.entries('content').length}:${ctx.slots.resources('content').length}`),
              ctx.slots.one('content'),
            )
          },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          render: (resource) => createElement('span', null, resource.metadata?.name),
        },
      ],
    })
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Group',
      spec: {},
      variables: [{ name: 'showFirst', default: '' }],
      slots: [
        {
          name: 'content',
          items: [
            { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Probe', metadata: { name: 'hidden' }, visible: { $variable: 'showFirst' }, spec: {} },
            { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Probe', metadata: { name: 'shown' }, spec: {} },
          ],
        },
      ],
    }

    const view = render(createElement(ResourceRenderer, { resource, registry }))
    expect(view.getByTestId('counts').textContent).toBe('1:1')
    expect(view.queryByText('hidden')).toBeNull()
    expect(view.queryByText('shown')).toBeTruthy()

    await act(async () => context?.variables.set('showFirst', 'yes'))
    expect(view.getByTestId('counts').textContent).toBe('2:2')
    expect(view.queryByText('hidden')).toBeTruthy()
  })

  it('evaluates $or across role membership, matching provisr\'s admin-OR-operator pattern', async () => {
    let context: RenderContext | undefined
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'visibility',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          render: (_resource, ctx) => {
            context = ctx
            return createElement('div', { 'data-testid': 'root-probe' }, 'Visible')
          },
        },
      ],
    })
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Probe',
      visible: { $or: [{ $variable: 'roles', contains: 'admin' }, { $variable: 'roles', contains: 'operator' }] },
      // Starts visible so the kind's render() runs at least once and captures `context` —
      // an invisible root never renders, so there would be no engine handle to flip it back.
      spec: {},
      variables: [{ name: 'roles', type: 'string[]', default: ['operator'] }],
    }

    const view = render(createElement(ResourceRenderer, { resource, registry }))
    expect(view.queryByTestId('root-probe')).toBeTruthy()

    await act(async () => context?.variables.set('roles', ['viewer']))
    expect(view.queryByTestId('root-probe')).toBeNull()

    await act(async () => context?.variables.set('roles', ['admin']))
    expect(view.queryByTestId('root-probe')).toBeTruthy()
  })

  it('evaluates $not over $and, e.g. hiding a field unless every guard condition holds', async () => {
    let context: RenderContext | undefined
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'visibility',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          render: (_resource, ctx) => {
            context = ctx
            return createElement('div', { 'data-testid': 'root-probe' }, 'Visible')
          },
        },
      ],
    })
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Probe',
      visible: { $not: { $and: [{ $variable: 'roles', contains: 'admin' }, { $variable: 'locked' }] } },
      // Starts visible (locked unset, so $and is false and $not flips it to true) so the
      // kind's render() runs at least once and captures `context`.
      spec: {},
      variables: [
        { name: 'roles', type: 'string[]', default: ['admin'] },
        { name: 'locked', default: '' },
      ],
    }

    const view = render(createElement(ResourceRenderer, { resource, registry }))
    expect(view.queryByTestId('root-probe')).toBeTruthy()

    await act(async () => context?.variables.set('locked', 'yes'))
    expect(view.queryByTestId('root-probe')).toBeNull()

    await act(async () => context?.variables.set('locked', ''))
    expect(view.queryByTestId('root-probe')).toBeTruthy()
  })
})

describe('ResourceRenderer disabled', () => {
  it('exposes disabled via RenderContext without gating rendering', async () => {
    let context: RenderContext | undefined
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'disabled',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          render: (_resource, ctx) => {
            context = ctx
            return createElement('div', { 'data-testid': 'root-probe' }, ctx.disabled ? 'Disabled' : 'Enabled')
          },
        },
      ],
    })
    const resource: Resource = {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Probe',
      disabled: { $variable: 'roles', contains: 'admin' },
      spec: {},
      variables: [{ name: 'roles', type: 'string[]', default: [] }],
    }

    const view = render(createElement(ResourceRenderer, { resource, registry }))
    expect(view.getByTestId('root-probe').textContent).toBe('Enabled')
    expect(context?.disabled).toBe(false)

    await act(async () => context?.variables.set('roles', ['admin']))
    expect(view.getByTestId('root-probe').textContent).toBe('Disabled')
    expect(context?.disabled).toBe(true)
  })

  it('defaults disabled to false when the resource declares none', () => {
    let context: RenderContext | undefined
    const registry = createRegistry<KindRenderFn>()
    registry.use({
      name: 'disabled',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Probe',
          specSchema: { type: 'object' },
          render: (_resource, ctx) => {
            context = ctx
            return createElement('div', { 'data-testid': 'root-probe' }, 'Enabled')
          },
        },
      ],
    })
    const resource: Resource = { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Probe', spec: {} }

    render(createElement(ResourceRenderer, { resource, registry }))
    expect(context?.disabled).toBe(false)
  })
})
