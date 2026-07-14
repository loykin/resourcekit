import { createDatasourceManager, defineDatasourcePlugin, tableRowsToFrame } from '@loykin/datasourcekit'
import type { DatasourceManagerBackend, QueryResult } from '@loykin/datasourcekit'

/**
 * A tiny in-memory dataset behind a hand-written `DatasourceManagerBackend`
 * (test.md §8.2, README quickstart) — DatasourceKit is a frontend contract
 * layer only, it doesn't run in a backend itself, so this stands in for
 * whatever real backend (Go/Java/Python/Node) would answer these calls in
 * production. Proves `@loykin/resourcekit/adapters/datasourcekit` against
 * the real published package, the same way `sqlite-connection-adapter.ts`
 * proves a hand-written `ConnectionAdapter` against a real SQLite db.
 */
interface MetricRow {
  host: string
  region: string
  cpuPercent: number
  memoryPercent: number
}

const metrics: MetricRow[] = [
  { host: 'web-1', region: 'us-east', cpuPercent: 42, memoryPercent: 61 },
  { host: 'web-2', region: 'us-east', cpuPercent: 77, memoryPercent: 55 },
  { host: 'db-1', region: 'us-west', cpuPercent: 88, memoryPercent: 90 },
  { host: 'db-2', region: 'us-west', cpuPercent: 35, memoryPercent: 48 },
]

interface DemoMetricsQuery {
  metric: 'cpuPercent' | 'memoryPercent'
  region?: string
}

export const DATASOURCE_UID = 'demo-metrics-main'
export const DATASOURCE_TYPE = 'demo-metrics'

function isMetricName(value: unknown): value is DemoMetricsQuery['metric'] {
  return value === 'cpuPercent' || value === 'memoryPercent'
}

function runQuery(query: DemoMetricsQuery): QueryResult {
  const rows = metrics.filter((row) => !query.region || row.region === query.region)
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

const demoMetricsPlugin = defineDatasourcePlugin<Record<string, never>, DemoMetricsQuery>({
  type: DATASOURCE_TYPE,
  name: 'Demo Metrics',
  description: 'In-memory demo metrics — host, region, cpuPercent, memoryPercent.',
})

const backend: DatasourceManagerBackend = {
  types: {
    list: async () => [{ type: DATASOURCE_TYPE, name: 'Demo Metrics' }],
    get: async (type) => ({ type, name: 'Demo Metrics' }),
  },
  instances: {
    list: async () => ({ items: [{ uid: DATASOURCE_UID, type: DATASOURCE_TYPE, name: 'Demo Metrics' }] }),
    get: async (uid) => ({ uid, type: DATASOURCE_TYPE, name: 'Demo Metrics' }),
    create: async () => {
      throw new Error('demo-datasourcekit backend is read-only')
    },
    update: async () => {
      throw new Error('demo-datasourcekit backend is read-only')
    },
    delete: async () => {
      throw new Error('demo-datasourcekit backend is read-only')
    },
  },
  query: async (request) => runQuery(request.query as DemoMetricsQuery),
  healthCheck: async () => ({ ok: true, message: 'demo metrics store reachable' }),
  validateQuery: async (_uid, query) => {
    const candidate = query as Partial<DemoMetricsQuery> | undefined
    const errors: string[] = []
    if (!isMetricName(candidate?.metric)) errors.push('metric must be "cpuPercent" or "memoryPercent"')
    return errors.length === 0 ? { valid: true } : { valid: false, errors }
  },
  listNamespaces: async () => [{ id: 'metrics', name: 'metrics' }],
  listFields: async () => [
    { name: 'host', type: 'string' },
    { name: 'region', type: 'string' },
    { name: 'cpuPercent', type: 'number' },
    { name: 'memoryPercent', type: 'number' },
  ],
}

export function startDemoDatasourceKit() {
  return createDatasourceManager({ plugins: [demoMetricsPlugin], backend })
}
