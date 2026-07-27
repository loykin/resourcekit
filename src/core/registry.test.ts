import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry'
import { staticResolver } from '../dataflow/resolvers'
import type { ConnectionManifest, DataSourceManifest, RegisteredConnection, StaticBindingSpec } from './types'

const API_VERSION = 'resourcekit.dev/v1alpha1'

function testConnectionManifest(): ConnectionManifest {
  return {
    apiVersion: API_VERSION,
    kind: 'rest',
    requestSchema: { type: 'object' },
    test: async () => ({ ok: true }),
    preview: async () => ({ schema: { type: 'object' }, rows: [], truncated: false }),
    resolve: async () => [],
  }
}

function testConnection(overrides: Partial<RegisteredConnection> = {}): RegisteredConnection {
  return {
    uid: 'crm-api',
    apiVersion: API_VERSION,
    kind: 'rest',
    name: 'CRM API',
    config: { baseUrl: 'https://api.example.com/crm', token: 'secret-token' },
    mcpPolicy: { mutate: true },
    ...overrides,
  }
}

function staticManifest(): DataSourceManifest<StaticBindingSpec> {
  return { apiVersion: API_VERSION, kind: 'static', resolve: staticResolver }
}

describe('createRegistry', () => {
  it('registers and looks up kinds from a plugin', () => {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: API_VERSION,
          kind: 'TestPanel',
          specSchema: { type: 'object' },
        },
      ],
    })

    expect(registry.getKind(API_VERSION, 'TestPanel')).toBeDefined()
    expect(registry.getKind(API_VERSION, 'Missing')).toBeUndefined()
    expect(registry.listKinds()).toHaveLength(1)
  })

  it('registers data source manifests and notifies subscribers', () => {
    const registry = createRegistry()
    let notified = 0
    registry.subscribe(() => notified++)

    registry.use({ name: 'resolvers', dataSourceManifests: [staticManifest()] })

    expect(registry.getDataSourceManifest(API_VERSION, 'static')?.resolve).toBe(staticResolver)
    expect(registry.getDataSourceManifest(API_VERSION, 'rest')).toBeUndefined()
    expect(notified).toBe(1)
  })

  it('registers a data source manifest with optional queryKey/schema enrichment', () => {
    const registry = createRegistry()
    const manifest: DataSourceManifest<StaticBindingSpec> = {
      apiVersion: API_VERSION,
      kind: 'static',
      resolve: staticResolver,
      queryKey: () => ['static'],
      specSchema: { type: 'object', required: ['rows'], properties: { rows: { type: 'array' } } },
    }

    registry.use({ name: 'resolvers', dataSourceManifests: [manifest] })

    expect(registry.getDataSourceManifest(API_VERSION, 'static')).toBe(manifest)
    expect(registry.getDataSourceManifest(API_VERSION, 'rest')).toBeUndefined()
    expect(registry.listDataSourceManifests()).toEqual([manifest])
  })

  it('resolves static bindings to their rows', async () => {
    const rows = [{ id: '1' }]
    await expect(
      staticResolver({ apiVersion: API_VERSION, kind: 'static', spec: { rows } }, { variables: {} }),
    ).resolves.toBe(rows)
  })

  it('derives scoped registry views without mutating the source registry', () => {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: API_VERSION,
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
          apiVersion: API_VERSION,
          kind: 'Login',
          specSchema: { type: 'object' },
        },
      ],
      dataSourceManifests: [staticManifest()],
    })

    const scoped = registry.scope({
      kinds: { include: ['Panel'] },
      spec: { Panel: { pick: ['title', 'pageSize'], lock: { pageSize: 50 } } },
      slots: { Panel: { include: ['main'] } },
    })

    expect(scoped.getKind(API_VERSION, 'Login')).toBeUndefined()
    expect(scoped.listKinds().map((kind) => kind.kind)).toEqual(['Panel'])
    expect(scoped.getDataSourceManifest(API_VERSION, 'static')?.resolve).toBe(staticResolver)

    const scopedPanel = scoped.getKind(API_VERSION, 'Panel')
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

    expect(registry.getKind(API_VERSION, 'Panel')?.slotPolicy?.slots).toHaveProperty('aside')
  })

  it('excludes a hostAuthoredOnly kind from scope() even when kinds.include names it explicitly', () => {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: API_VERSION,
          kind: 'JSONSchemaForm',
          specSchema: { type: 'object', properties: { jsonSchema: { type: 'object' } } },
          hostAuthoredOnly: true,
        },
        {
          apiVersion: API_VERSION,
          kind: 'Panel',
          specSchema: { type: 'object' },
        },
      ],
    })

    // Renders normally when hand-authored (not gated by hostAuthoredOnly).
    expect(registry.getKind(API_VERSION, 'JSONSchemaForm')).toBeDefined()

    const scoped = registry.scope({ kinds: { include: ['JSONSchemaForm', 'Panel'] } })
    expect(scoped.getKind(API_VERSION, 'JSONSchemaForm')).toBeUndefined()
    expect(scoped.listKinds().map((kind) => kind.kind)).toEqual(['Panel'])
  })

  it('excludes a dataSourceManifests kind from a scope while the unscoped registry keeps seeing it', () => {
    const registry = createRegistry()
    registry.use({
      name: 'resolvers',
      dataSourceManifests: [staticManifest(), { apiVersion: API_VERSION, kind: 'rest', resolve: staticResolver }],
    })

    const scoped = registry.scope({ dataSourceManifests: { exclude: ['static'] } })

    expect(scoped.getDataSourceManifest(API_VERSION, 'static')).toBeUndefined()
    expect(scoped.getDataSourceManifest(API_VERSION, 'rest')?.resolve).toBe(staticResolver)
    expect(scoped.listDataSourceManifests().map((m) => m.kind)).toEqual(['rest'])
    expect(registry.getDataSourceManifest(API_VERSION, 'static')?.resolve).toBe(staticResolver)
  })

  it('narrows dataSourceManifests to an include list', () => {
    const registry = createRegistry()
    registry.use({
      name: 'resolvers',
      dataSourceManifests: [
        staticManifest(),
        { apiVersion: API_VERSION, kind: 'rest', resolve: staticResolver },
        { apiVersion: API_VERSION, kind: 'datasource', resolve: staticResolver },
      ],
    })

    const scoped = registry.scope({ dataSourceManifests: { include: ['rest'] } })

    expect(scoped.listDataSourceManifests().map((m) => m.kind)).toEqual(['rest'])
    expect(scoped.getDataSourceManifest(API_VERSION, 'static')).toBeUndefined()
    expect(scoped.getDataSourceManifest(API_VERSION, 'datasource')).toBeUndefined()
  })

  it('excludes a mutationSourceManifests kind from a scope', () => {
    const registry = createRegistry()
    const memoryResolve = async () => ({ id: '1' })
    const restResolve = async () => ({ id: '2' })
    registry.use({
      name: 'mutations',
      mutationSourceManifests: [
        { apiVersion: API_VERSION, kind: 'memory', resolve: memoryResolve },
        { apiVersion: API_VERSION, kind: 'rest', resolve: restResolve },
      ],
    })

    const scoped = registry.scope({ mutationSourceManifests: { exclude: ['memory'] } })

    expect(scoped.getMutationSourceManifest(API_VERSION, 'memory')).toBeUndefined()
    expect(scoped.getMutationSourceManifest(API_VERSION, 'rest')?.resolve).toBe(restResolve)
    expect(scoped.listMutationSourceManifests().map((m) => m.kind)).toEqual(['rest'])
    expect(registry.getMutationSourceManifest(API_VERSION, 'memory')?.resolve).toBe(memoryResolve)
  })

  it('excludes a connectionManifests kind from a scope', () => {
    const registry = createRegistry()
    const restManifest = testConnectionManifest()
    registry.use({ name: 'manifests', connectionManifests: [restManifest] })

    const scoped = registry.scope({ connectionManifests: { exclude: ['rest'] } })

    expect(scoped.getConnectionManifest(API_VERSION, 'rest')).toBeUndefined()
    expect(scoped.listConnectionManifests()).toEqual([])
    expect(registry.getConnectionManifest(API_VERSION, 'rest')).toBe(restManifest)
  })

  it('registers, looks up, and unregisters connections dynamically without recreating the registry', async () => {
    const registry = createRegistry()
    registry.use({ name: 'rest-connections', connectionManifests: [testConnectionManifest()] })

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
    registry.use({ name: 'rest-connections', connectionManifests: [testConnectionManifest()] })
    registry.registerConnection(testConnection())
    registry.registerConnection(testConnection({ uid: 'metrics-main', name: 'Metrics' }))

    const scoped = registry.scope({
      connections: { allow: ['crm-api'], capabilities: { test: true, inspect: true, preview: false, mutate: false } },
    })

    const summaries = await scoped.listConnections()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toEqual({
      uid: 'crm-api',
      apiVersion: API_VERSION,
      kind: 'rest',
      name: 'CRM API',
      description: undefined,
      requestSchema: { type: 'object' },
      // manifest has test/preview, connection.mcpPolicy allows mutate, but scope caps preview=false and mutate=false
      capabilities: { test: true, inspect: false, preview: false, mutate: false },
    })
    expect(summaries[0]).not.toHaveProperty('config')

    // the render path still gets the full connection (with config) for allowed UIDs, scoped by allowlist only
    expect((await scoped.getConnection('crm-api'))?.config).toEqual({ baseUrl: 'https://api.example.com/crm', token: 'secret-token' })
    expect(await scoped.getConnection('metrics-main')).toBeUndefined()
  })

  it('exposes a manifest resultSchema on the connection summary when the manifest declares one', async () => {
    const registry = createRegistry()
    registry.use({
      name: 'rest-connections',
      connectionManifests: [{ ...testConnectionManifest(), resultSchema: { type: 'object', properties: { id: { type: 'string' } } } }],
    })
    registry.registerConnection(testConnection())

    const scoped = registry.scope({})
    const summaries = await scoped.listConnections()
    expect(summaries[0].resultSchema).toEqual({ type: 'object', properties: { id: { type: 'string' } } })
  })

  it('falls back to a ConnectionProvider when a uid is not statically registered, merging list results', async () => {
    const registry = createRegistry()
    registry.use({ name: 'rest-connections', connectionManifests: [testConnectionManifest()] })
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
    registry.use({ name: 'rest-connections', connectionManifests: [testConnectionManifest()] })

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
