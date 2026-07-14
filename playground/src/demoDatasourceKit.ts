import { createDatasourceManager, defineDatasourcePlugin, tableRowsToFrame } from '@loykin/datasourcekit'
import type { DatasourceManagerBackend, QueryResult } from '@loykin/datasourcekit'
import type { ConnectionProvider, RegisteredConnection } from '@loykin/resourcekit'
import type { DatasourceKitConnectionConfig } from '@loykin/resourcekit/adapters/datasourcekit'

interface MetricRow {
  host: string
  region: string
  cpuPercent: number
  memoryPercent: number
}

interface MetricsQuery {
  metric: 'cpuPercent' | 'memoryPercent'
  region?: string
  host?: string
}

const DATASOURCE_UID = 'playground-metrics-main'
const DATASOURCE_TYPE = 'playground-metrics'

const metrics: MetricRow[] = [
  { host: 'web-1', region: 'us-east', cpuPercent: 42, memoryPercent: 61 },
  { host: 'web-2', region: 'us-east', cpuPercent: 77, memoryPercent: 55 },
  { host: 'db-1', region: 'us-west', cpuPercent: 88, memoryPercent: 90 },
  { host: 'db-2', region: 'us-west', cpuPercent: 35, memoryPercent: 48 },
]

function isMetric(value: unknown): value is MetricsQuery['metric'] {
  return value === 'cpuPercent' || value === 'memoryPercent'
}

function runQuery(query: MetricsQuery): QueryResult {
  const rows = metrics.filter((row) => (!query.region || row.region === query.region) && (!query.host || row.host === query.host))
  return {
    frames: [
      tableRowsToFrame({
        name: 'metrics',
        columns: [
          { name: 'host', type: 'string' },
          { name: 'region', type: 'string' },
          { name: query.metric, type: 'number' },
        ],
        rows: rows.map((row) => [row.host, row.region, row[query.metric]]),
      }),
    ],
  }
}

const plugin = defineDatasourcePlugin<Record<string, never>, MetricsQuery>({
  type: DATASOURCE_TYPE,
  name: 'Playground Metrics',
})

const backend: DatasourceManagerBackend = {
  types: {
    list: async () => [{ type: DATASOURCE_TYPE, name: 'Playground Metrics' }],
    get: async () => ({ type: DATASOURCE_TYPE, name: 'Playground Metrics' }),
  },
  instances: {
    list: async () => ({ items: [{ uid: DATASOURCE_UID, type: DATASOURCE_TYPE, name: 'Playground Metrics' }] }),
    get: async () => ({ uid: DATASOURCE_UID, type: DATASOURCE_TYPE, name: 'Playground Metrics' }),
    create: async () => {
      throw new Error('playground metrics backend is read-only')
    },
    update: async () => {
      throw new Error('playground metrics backend is read-only')
    },
    delete: async () => {
      throw new Error('playground metrics backend is read-only')
    },
  },
  query: async (request) => runQuery(request.query as MetricsQuery),
  healthCheck: async () => ({ ok: true, message: 'in-browser metrics backend reachable' }),
  validateQuery: async (_uid, query) => {
    const candidate = query as Partial<MetricsQuery> | undefined
    return isMetric(candidate?.metric) ? { valid: true } : { valid: false, errors: ['metric must be "cpuPercent" or "memoryPercent"'] }
  },
  listNamespaces: async () => [{ id: 'metrics', name: 'metrics' }],
  listFields: async () => [
    { name: 'host', type: 'string' },
    { name: 'region', type: 'string' },
    { name: 'cpuPercent', type: 'number' },
    { name: 'memoryPercent', type: 'number' },
  ],
}

export function createPlaygroundDatasourceManager() {
  return createDatasourceManager({ plugins: [plugin], backend })
}

export function createPlaygroundConnectionProvider(): ConnectionProvider {
  const connection: RegisteredConnection<DatasourceKitConnectionConfig> = {
    uid: 'demo-metrics-dynamic',
    type: 'datasourcekit',
    name: 'Dynamic Playground Metrics',
    description: 'In-browser DatasourceKit connection resolved through ConnectionProvider.',
    config: { datasourceUid: DATASOURCE_UID, datasourceType: DATASOURCE_TYPE },
    mcpPolicy: { test: true, inspect: true, preview: true, mutate: false, maxRows: 20 },
  }

  return {
    getConnection: async (uid) => (uid === connection.uid ? connection : undefined),
    listConnections: async () => [connection],
  }
}
