import { afterEach, describe, expect, it } from 'vitest'
import { createConnectionDataResolver, createRegistry, restConnectionAdapter } from '@loykin/resourcekit'
import { DEMO_API_TOKEN, startDemoApi, type DemoApi } from './demo-api.js'
import { createSecureReportsConnection } from './secure-reports-connection.js'

let api: DemoApi | undefined

afterEach(() => {
  api?.close()
  api = undefined
})

describe('server-owned connection environment', () => {
  it('authenticates a real backend request without exposing the secret through the scoped catalog', async () => {
    api = await startDemoApi()
    const registry = createRegistry()
    registry.use({
      name: 'secure-reports-e2e',
      dataResolvers: { connection: createConnectionDataResolver(registry) },
      connectionAdapters: { rest: restConnectionAdapter },
    })
    registry.registerConnection(
      createSecureReportsConnection({
        RESOURCEKIT_SECURE_REPORTS_URL: api.baseUrl,
        RESOURCEKIT_SECURE_REPORTS_TOKEN: DEMO_API_TOKEN,
      }),
    )

    const scoped = registry.scope({
      connections: { allow: ['secure-reports'], capabilities: { test: true, preview: true, mutate: false } },
    })
    const catalog = await scoped.listConnections()
    expect(JSON.stringify(catalog)).not.toContain(DEMO_API_TOKEN)
    expect(catalog[0]).not.toHaveProperty('config')

    const rows = await scoped.getDataResolver('connection')?.(
      { source: 'connection', connection: 'secure-reports', request: { path: '/secure/reports' } },
      { variables: {} },
    )
    expect(rows).toEqual([
      { quarter: 'Q1', revenue: 482000, headcount: 34 },
      { quarter: 'Q2', revenue: 511000, headcount: 37 },
    ])
  })

  it('fails closed when required environment values are missing', () => {
    expect(() => createSecureReportsConnection({})).toThrow('RESOURCEKIT_SECURE_REPORTS_URL is required')
    expect(() => createSecureReportsConnection({ RESOURCEKIT_SECURE_REPORTS_URL: 'https://reports.example.com' })).toThrow(
      'RESOURCEKIT_SECURE_REPORTS_TOKEN is required',
    )
  })
})
