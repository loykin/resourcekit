import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry'
import { staticResolver } from './resolvers'
import type { ConnectionAdapter, RegisteredConnection } from './types'

function testConnectionAdapter(): ConnectionAdapter {
  return {
    type: 'rest',
    requestSchema: { type: 'object' },
    test: async () => ({ ok: true }),
    preview: async () => ({ schema: { type: 'object' }, rows: [], truncated: false }),
    resolve: async () => [],
  }
}

function testConnection(overrides: Partial<RegisteredConnection> = {}): RegisteredConnection {
  return {
    uid: 'crm-api',
    type: 'rest',
    name: 'CRM API',
    config: { baseUrl: 'https://api.example.com/crm', token: 'secret-token' },
    mcpPolicy: { mutate: true },
    ...overrides,
  }
}

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

  it('registers a data source adapter without requiring or replacing its resolver', () => {
    const registry = createRegistry()
    const adapter = { source: 'static', resolve: staticResolver, queryKey: () => ['static'] }

    registry.use({ name: 'resolvers', dataResolvers: { static: staticResolver } })
    registry.use({ name: 'adapters', dataSourceAdapters: { static: adapter } })

    expect(registry.getDataResolver('static')).toBe(staticResolver)
    expect(registry.getDataSourceAdapter('static')).toBe(adapter)
    expect(registry.getDataSourceAdapter('rest')).toBeUndefined()
    expect(registry.listDataSourceAdapters()).toEqual([adapter])
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
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        pageSize: { const: 50 },
      },
      required: ['pageSize'],
    })

    expect(registry.getKind('resourcekit.dev/v1alpha1', 'Panel')?.slotPolicy?.slots).toHaveProperty('aside')
  })

  it('registers, looks up, and unregisters connections dynamically without recreating the registry', async () => {
    const registry = createRegistry()
    registry.use({ name: 'rest-connections', connectionAdapters: { rest: testConnectionAdapter() } })

    let notified = 0
    registry.subscribe(() => notified++)

    registry.registerConnection(testConnection())
    expect(await registry.getConnection('crm-api')).toEqual(testConnection())
    expect(await registry.listConnections()).toHaveLength(1)
    expect(notified).toBe(1)

    registry.unregisterConnection('crm-api')
    expect(await registry.getConnection('crm-api')).toBeUndefined()
    expect(notified).toBe(2)
  })

  it('scopes connections to an allowlist and strips config while computing capabilities', async () => {
    const registry = createRegistry()
    registry.use({ name: 'rest-connections', connectionAdapters: { rest: testConnectionAdapter() } })
    registry.registerConnection(testConnection())
    registry.registerConnection(testConnection({ uid: 'metrics-main', name: 'Metrics' }))

    const scoped = registry.scope({
      connections: { allow: ['crm-api'], capabilities: { test: true, inspect: true, preview: false, mutate: false } },
    })

    const summaries = await scoped.listConnections()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toEqual({
      uid: 'crm-api',
      type: 'rest',
      name: 'CRM API',
      description: undefined,
      requestSchema: { type: 'object' },
      // adapter has test/preview, connection.mcpPolicy allows mutate, but scope caps preview=false and mutate=false
      capabilities: { test: true, inspect: false, preview: false, mutate: false },
    })
    expect(summaries[0]).not.toHaveProperty('config')

    // the render path still gets the full connection (with config) for allowed UIDs, scoped by allowlist only
    expect((await scoped.getConnection('crm-api'))?.config).toEqual({ baseUrl: 'https://api.example.com/crm', token: 'secret-token' })
    expect(await scoped.getConnection('metrics-main')).toBeUndefined()
  })

  it('exposes an adapter resultSchema on the connection summary when the adapter declares one', async () => {
    const registry = createRegistry()
    registry.use({
      name: 'rest-connections',
      connectionAdapters: { rest: { ...testConnectionAdapter(), resultSchema: { type: 'object', properties: { id: { type: 'string' } } } } },
    })
    registry.registerConnection(testConnection())

    const scoped = registry.scope({})
    const summaries = await scoped.listConnections()
    expect(summaries[0].resultSchema).toEqual({ type: 'object', properties: { id: { type: 'string' } } })
  })

  it('falls back to a ConnectionProvider when a uid is not statically registered, merging list results', async () => {
    const registry = createRegistry()
    registry.use({ name: 'rest-connections', connectionAdapters: { rest: testConnectionAdapter() } })
    registry.registerConnection(testConnection())

    const provided = testConnection({ uid: 'metrics-main', name: 'Metrics (provided)' })
    registry.setConnectionProvider({
      getConnection: async (uid) => (uid === provided.uid ? provided : undefined),
      listConnections: async () => [provided],
    })

    expect(await registry.getConnection('metrics-main')).toEqual(provided)
    expect(await registry.listConnections()).toHaveLength(2)

    // static registration still wins on uid collision with the provider
    registry.setConnectionProvider({
      getConnection: async (uid) => (uid === 'crm-api' ? testConnection({ name: 'CRM API (from provider)' }) : undefined),
      listConnections: async () => [testConnection({ name: 'CRM API (from provider)' })],
    })
    expect(await registry.getConnection('crm-api')).toEqual(testConnection())

    registry.setConnectionProvider(undefined)
    expect(await registry.getConnection('metrics-main')).toBeUndefined()
  })

  it('discards a provider result whose own uid does not match the uid it was looked up by', async () => {
    const registry = createRegistry()
    registry.use({ name: 'rest-connections', connectionAdapters: { rest: testConnectionAdapter() } })

    const secret = testConnection({ uid: 'secret', name: 'Secret' })
    registry.setConnectionProvider({
      // Buggy/malicious provider: whatever uid is requested, it hands back "secret".
      getConnection: async () => secret,
      listConnections: async () => [secret],
    })

    expect(await registry.getConnection('allowed')).toBeUndefined()

    // A scope allowlisting only "allowed" must not be able to reach "secret"
    // through a mismatched provider response either.
    const scoped = registry.scope({ connections: { allow: ['allowed'] } })
    expect(await scoped.getConnection('allowed')).toBeUndefined()
  })
})
