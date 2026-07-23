import { tableRowsToFrame } from '@loykin/datasourcekit'
import type { DatasourceManager } from '@loykin/datasourcekit'
import { describe, expect, it, vi } from 'vitest'
import type { RegisteredConnection } from '../../core/types'
import { createDatasourceKitConnectionAdapter, type DatasourceKitConnectionConfig } from './adapter'

function testConnection(overrides: Partial<RegisteredConnection<DatasourceKitConnectionConfig>> = {}): RegisteredConnection<DatasourceKitConnectionConfig> {
  return {
    uid: 'metrics-main',
    type: 'datasourcekit',
    name: 'Metrics',
    config: { datasourceUid: 'metrics-main', datasourceType: 'demo-metrics' },
    ...overrides,
  }
}

function fakeManager(overrides: Partial<DatasourceManager['instances']> = {}): DatasourceManager {
  return {
    registerPlugin: vi.fn(),
    registry: {} as DatasourceManager['registry'],
    types: {} as DatasourceManager['types'],
    instances: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(),
      batchQuery: vi.fn(),
      healthCheck: vi.fn(),
      validateQuery: vi.fn(),
      listNamespaces: vi.fn(),
      listFields: vi.fn(),
      ...overrides,
    },
  }
}

describe('createDatasourceKitConnectionAdapter', () => {
  it('test() bridges to instances.healthCheck with the connection uid/type', async () => {
    const healthCheck = vi.fn().mockResolvedValue({ ok: true, message: 'reachable' })
    const manager = fakeManager({ healthCheck })
    const adapter = createDatasourceKitConnectionAdapter(manager)

    const result = await adapter.test?.(testConnection(), {})
    expect(healthCheck).toHaveBeenCalledWith('metrics-main', 'demo-metrics', expect.objectContaining({ signal: undefined }))
    expect(result).toEqual({ ok: true, message: 'reachable' })
  })

  it('inspect() with no path lists namespaces by id', async () => {
    const listNamespaces = vi.fn().mockResolvedValue([{ id: 'metrics', name: 'Metrics table' }])
    const manager = fakeManager({ listNamespaces })
    const adapter = createDatasourceKitConnectionAdapter(manager)

    const result = await adapter.inspect?.(testConnection(), {}, {})
    expect(listNamespaces).toHaveBeenCalledWith('metrics-main', 'demo-metrics', expect.anything())
    expect(result).toEqual({ namespaces: ['metrics'] })
  })

  it('inspect() with a path lists fields for that namespace', async () => {
    const listFields = vi.fn().mockResolvedValue([{ name: 'host', type: 'string' }, { name: 'cpuPercent', type: 'number' }])
    const manager = fakeManager({ listFields })
    const adapter = createDatasourceKitConnectionAdapter(manager)

    const result = await adapter.inspect?.(testConnection(), { path: 'metrics' }, {})
    expect(listFields).toHaveBeenCalledWith('metrics-main', 'demo-metrics', { namespaceId: 'metrics' }, expect.anything())
    expect(result).toEqual({ fields: [{ name: 'host', type: 'string' }, { name: 'cpuPercent', type: 'number' }] })
  })

  it('validate() maps DatasourceValidationResult.errors to RequestValidationResult.issues', async () => {
    const validateQuery = vi.fn().mockResolvedValue({ valid: false, errors: ['metric is required'] })
    const manager = fakeManager({ validateQuery })
    const adapter = createDatasourceKitConnectionAdapter(manager)

    const result = await adapter.validate?.(testConnection(), { metric: undefined }, {})
    expect(result).toEqual({ valid: false, issues: ['metric is required'] })
  })

  it('resolve() flattens the first frame into rows', async () => {
    const frame = tableRowsToFrame({
      columns: [{ name: 'host', type: 'string' }, { name: 'cpuPercent', type: 'number' }],
      rows: [
        ['web-1', 42],
        ['web-2', 77],
      ],
    })
    const query = vi.fn().mockResolvedValue({ frames: [frame] })
    const manager = fakeManager({ query })
    const adapter = createDatasourceKitConnectionAdapter(manager)

    const rows = await adapter.resolve(testConnection(), { metric: 'cpuPercent' }, { variables: {} })
    expect(rows).toEqual([
      { host: 'web-1', cpuPercent: 42 },
      { host: 'web-2', cpuPercent: 77 },
    ])
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceUid: 'metrics-main', datasourceType: 'demo-metrics', query: { metric: 'cpuPercent' } }),
      expect.anything(),
    )
  })

  it('resolve() returns an empty array when the query returns no frames', async () => {
    const query = vi.fn().mockResolvedValue({ frames: [] })
    const manager = fakeManager({ query })
    const adapter = createDatasourceKitConnectionAdapter(manager)

    await expect(adapter.resolve(testConnection(), {}, { variables: {} })).resolves.toEqual([])
  })

  it('preview() requests maxRows + 1, caps rows to mcpPolicy.maxRows, and reports truncated', async () => {
    const frame = tableRowsToFrame({
      columns: [{ name: 'host', type: 'string' }],
      // Exactly maxRows(2) + 1: what a backend that honors the options hint
      // and caps its own response would return when more rows really exist.
      rows: [['web-1'], ['web-2'], ['web-3']],
    })
    const query = vi.fn().mockResolvedValue({ frames: [frame], stats: { executionTimeMs: 5 } })
    const manager = fakeManager({ query })
    const adapter = createDatasourceKitConnectionAdapter(manager)

    const preview = await adapter.preview?.(testConnection({ mcpPolicy: { maxRows: 2 } }), {}, {})
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ options: { maxRows: 3 } }), expect.anything())
    expect(preview?.rows).toEqual([{ host: 'web-1' }, { host: 'web-2' }])
    expect(preview?.truncated).toBe(true)
    expect(preview?.stats).toEqual({ returnedRows: 2, executionTimeMs: 5 })
    expect(preview?.schema).toEqual({ type: 'object', properties: { host: { type: 'string' } } })
  })

  it('preview() reports untruncated when the backend has nothing past the cap', async () => {
    const frame = tableRowsToFrame({ columns: [{ name: 'host', type: 'string' }], rows: [['web-1'], ['web-2']] })
    const query = vi.fn().mockResolvedValue({ frames: [frame] })
    const manager = fakeManager({ query })
    const adapter = createDatasourceKitConnectionAdapter(manager)

    const preview = await adapter.preview?.(testConnection({ mcpPolicy: { maxRows: 5 } }), {}, {})
    expect(preview?.rows).toHaveLength(2)
    expect(preview?.truncated).toBe(false)
  })

  it('preview() applies a default cap of 20 when no mcpPolicy.maxRows is set', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => [`web-${i}`])
    const frame = tableRowsToFrame({ columns: [{ name: 'host', type: 'string' }], rows })
    const query = vi.fn().mockResolvedValue({ frames: [frame] })
    const manager = fakeManager({ query })
    const adapter = createDatasourceKitConnectionAdapter(manager)

    const preview = await adapter.preview?.(testConnection(), {}, {})
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ options: { maxRows: 21 } }), expect.anything())
    expect(preview?.rows).toHaveLength(20)
    expect(preview?.truncated).toBe(true)
  })
})
