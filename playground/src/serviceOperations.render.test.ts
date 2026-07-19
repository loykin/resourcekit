// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createServer, type Server } from 'node:http'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ResourceRenderer } from '@loykin/resourcekit/react'
import { validateResourceDocument } from '@loykin/resourcekit'
import { createServiceOperationsApi } from '../server/service-operations-api'

let app: typeof import('./App')
let server: Server
const backend = createServiceOperationsApi()

beforeAll(async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  server = createServer((req, res) => {
    backend.middleware(req, res, () => {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  app = await import('./App')
  app.registry.registerConnection({
    uid: 'service-operations',
    type: 'rest',
    name: 'Service Operations API (E2E)',
    config: { baseUrl: `http://127.0.0.1:${port}` },
    policy: { methods: ['GET'], pathPrefixes: ['/incidents'] },
    mcpPolicy: { test: true, preview: true, mutate: false, maxRows: 20 },
  })
})

afterEach(cleanup)
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))))

describe('service operations command center', () => {
  it('renders and completes real HTTP query, selection, mutation, and refetch flows', async () => {
    expect(validateResourceDocument(app.serviceOperationsPage, app.registry)).toEqual({ valid: true, issues: [] })
    render(createElement(ResourceRenderer, { registry: app.registry, resource: app.serviceOperationsPage }))

    expect(await screen.findByText('Incident queue')).toBeTruthy()
    expect(await screen.findByText('Shift handoff')).toBeTruthy()

    const readsBeforeFilter = backend.stats.incidentReads
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Monitoring' }))
    await waitFor(() => expect(backend.stats.incidentReads).toBeGreaterThan(readsBeforeFilter))
    expect(screen.queryByRole('button', { name: 'Checkout API Severity: CriticalOpen: 18m' })).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: 'Search Severity: HighOpen: 42m' }))
    expect(await screen.findByText('Indexing queue delay')).toBeTruthy()

    const readsBeforeSubmit = { incidents: backend.stats.incidentReads, detail: backend.stats.detailReads }
    fireEvent.change(screen.getByRole('textbox', { name: 'Next owner' }), { target: { value: 'Search on-call' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Handoff note' }), { target: { value: 'Watch indexing lag.' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save handoff' }))
    })

    await waitFor(() => expect(screen.getByText('Handoff saved and incident data refreshed')).toBeTruthy())
    expect(screen.getByText('Indexing queue delay')).toBeTruthy()
    expect(backend.stats.handoffWrites).toBe(1)
    expect(backend.stats.lastHandoff).toEqual({ owner: 'Search on-call', note: 'Watch indexing lag.' })
    expect(backend.stats.incidentReads).toBeGreaterThan(readsBeforeSubmit.incidents)
    expect(backend.stats.detailReads).toBeGreaterThan(readsBeforeSubmit.detail)
  })
})
