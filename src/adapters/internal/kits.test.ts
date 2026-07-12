import { describe, expect, it } from 'vitest'
import type { ResourceKitPlugin } from '../../types'
import type { KindRenderFn } from '../../react/types'
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
