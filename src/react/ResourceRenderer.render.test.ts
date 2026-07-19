// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResourceDocument } from '../dataflow'
import { createRegistry } from '../registry'
import type { Resource } from '../types'
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

  const document: ResourceDocument = {
    data: { nodes: { a: { kind: 'state', initialValue: 1 }, b: { kind: 'state', initialValue: 1 } } },
    resource: {
      apiVersion: 'resourcekit.dev/v1alpha1',
      kind: 'Group',
      spec: { variables: [{ name: 'shared', default: 'v1' }] },
      slots: [
        {
          items: [
            {
              apiVersion: 'resourcekit.dev/v1alpha1',
              kind: 'Probe',
              metadata: { name: 'probeA' },
              bindings: { value: { $data: 'a' } },
              spec: { events: { touch: { kind: 'setVariable', variable: 'shared', from: 'value' } } },
            },
            {
              apiVersion: 'resourcekit.dev/v1alpha1',
              kind: 'Probe',
              metadata: { name: 'probeB' },
              bindings: { value: { $data: 'b' } },
              spec: {},
            },
          ] satisfies Resource[],
        },
      ],
    },
  }

  return { registry, document, renderCounts, contexts }
}

describe('ResourceRenderer node-level re-render scoping', () => {
  it('re-renders only the resource whose own $data dependency changed', async () => {
    const { registry, document, renderCounts, contexts } = setup()
    render(createElement(ResourceRenderer, { resource: document, registry }))
    // Let the dataflow runtime's own async start()/initial state snapshot
    // writes (and the re-renders they trigger) fully settle before taking
    // a "before" baseline — otherwise this races with the assertions below.
    await act(async () => {})

    expect(renderCounts.probeA).toBeGreaterThanOrEqual(1)
    expect(renderCounts.probeB).toBeGreaterThanOrEqual(1)
    const [countsBeforeA, countsBeforeB] = [renderCounts.probeA, renderCounts.probeB]

    await act(async () => {
      await contexts.probeA.data.set('a', 2)
    })

    expect(renderCounts.probeA).toBeGreaterThan(countsBeforeA)
    expect(renderCounts.probeB).toBe(countsBeforeB)

    const countsAfterFirstA = renderCounts.probeA
    await act(async () => {
      await contexts.probeB.data.set('b', 2)
    })

    expect(renderCounts.probeB).toBeGreaterThan(countsBeforeB)
    expect(renderCounts.probeA).toBe(countsAfterFirstA)
  })

  it('still re-renders every resource on a variable change (unchanged, global)', async () => {
    const { registry, document, renderCounts, contexts } = setup()
    render(createElement(ResourceRenderer, { resource: document, registry }))

    const [countsBeforeA, countsBeforeB] = [renderCounts.probeA, renderCounts.probeB]

    await act(async () => {
      contexts.probeA.events.emit('touch', { value: 'v2' })
    })

    expect(renderCounts.probeA).toBeGreaterThan(countsBeforeA)
    expect(renderCounts.probeB).toBeGreaterThan(countsBeforeB)
  })
})

describe('RecordScopeNode refetches on a pure $data dependency change', () => {
  it('re-fetches the record when the underlying dataflow node changes with no ${variable} involved', async () => {
    let latestRecord: Record<string, unknown> | undefined
    let context: RenderContext | undefined
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
            context = ctx
            return createElement('div', null, JSON.stringify(ctx.record))
          },
        },
      ],
    })
    const document: ResourceDocument = {
      data: { nodes: { customer: { kind: 'state', initialValue: { name: 'Ada' } } } },
      resource: {
        apiVersion: 'resourcekit.dev/v1alpha1',
        kind: 'RecordProbe',
        spec: { data: { $data: 'customer' } },
      },
    }

    render(createElement(ResourceRenderer, { resource: document, registry }))
    await act(async () => {})
    expect(latestRecord).toEqual({ name: 'Ada' })

    // No ${variable} is involved in this binding at all — before the fix,
    // stateKey never changed for a pure $data binding, so this update never
    // re-triggered the record fetch and latestRecord stayed { name: 'Ada' }.
    await act(async () => {
      await context?.data.set('customer', { name: 'Bob' })
    })

    expect(latestRecord).toEqual({ name: 'Bob' })
  })
})

describe('ResourceRenderer mutation-to-dataflow integration', () => {
  it('runs submit effects through the renderer and exposes the updated graph state', async () => {
    let context: RenderContext | undefined
    const query = vi.fn(async () => [{ id: 'row' }])
    const registry = createRegistry<KindRenderFn>()
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
    const document: ResourceDocument = {
      data: {
        nodes: {
          selected: { kind: 'state' },
          rows: { kind: 'resolve', binding: { source: 'query' } },
        },
      },
      resource: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'ActionProbe', spec: {} },
    }

    render(createElement(ResourceRenderer, { resource: document, registry }))
    await act(async () => {})
    expect(query).toHaveBeenCalledTimes(1)

    await act(async () => {
      await context?.actions.submit(
        {
          mutation: { target: 'memory' },
          onSuccess: [
            { kind: 'setData', node: 'selected', from: 'id' },
            { kind: 'invalidateData', nodes: ['rows'] },
            { kind: 'refetchData', nodes: ['rows'] },
          ],
        },
        { draft: true },
      )
    })

    expect(await context?.data.read({ $data: 'selected' })).toBe('saved')
    expect(query).toHaveBeenCalledTimes(2)
  })
})
