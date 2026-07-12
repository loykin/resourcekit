import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry'
import { staticResolver } from './resolvers'

describe('createRegistry', () => {
  it('registers and looks up kinds from a plugin', () => {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'TestPanel',
          specSchema: { type: 'object' },
        },
      ],
    })

    expect(registry.getKind('resourcekit.dev/v1alpha1', 'TestPanel')).toBeDefined()
    expect(registry.getKind('resourcekit.dev/v1alpha1', 'Missing')).toBeUndefined()
    expect(registry.listKinds()).toHaveLength(1)
  })

  it('registers data resolvers and notifies subscribers', () => {
    const registry = createRegistry()
    let notified = 0
    registry.subscribe(() => notified++)

    registry.use({ name: 'resolvers', dataResolvers: { static: staticResolver } })

    expect(registry.getDataResolver('static')).toBe(staticResolver)
    expect(registry.getDataResolver('rest')).toBeUndefined()
    expect(notified).toBe(1)
  })

  it('resolves static bindings to their rows', async () => {
    const rows = [{ id: '1' }]
    await expect(
      staticResolver({ source: 'static', rows }, { variables: {} }),
    ).resolves.toBe(rows)
  })

  it('derives scoped registry views without mutating the source registry', () => {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          specSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              pageSize: { type: 'number' },
              secret: { type: 'string' },
            },
          },
          slotPolicy: {
            slots: {
              main: { min: 1 },
              aside: { min: 0 },
            },
          },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Login',
          specSchema: { type: 'object' },
        },
      ],
      dataResolvers: { static: staticResolver },
    })

    const scoped = registry.scope({
      kinds: { include: ['Panel'] },
      spec: { Panel: { pick: ['title', 'pageSize'], lock: { pageSize: 50 } } },
      slots: { Panel: { include: ['main'] } },
    })

    expect(scoped.getKind('resourcekit.dev/v1alpha1', 'Login')).toBeUndefined()
    expect(scoped.listKinds().map((kind) => kind.kind)).toEqual(['Panel'])
    expect(scoped.getDataResolver('static')).toBe(staticResolver)

    const scopedPanel = scoped.getKind('resourcekit.dev/v1alpha1', 'Panel')
    expect(scopedPanel?.slotPolicy?.slots).toEqual({ main: { min: 1 } })
    expect(scopedPanel?.specSchema).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string' },
        pageSize: { const: 50 },
      },
      required: ['pageSize'],
    })

    expect(registry.getKind('resourcekit.dev/v1alpha1', 'Panel')?.slotPolicy?.slots).toHaveProperty('aside')
  })
})
