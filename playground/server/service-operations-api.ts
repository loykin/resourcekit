import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ServiceOperationsIncident {
  id: string
  service: string
  summary: string
  severity: string
  status: string
  owner: string
  age: string
  region: string
}

export interface ServiceOperationsApiStats {
  incidentReads: number
  detailReads: number
  handoffWrites: number
  lastHandoff?: Record<string, unknown>
}

const initialIncidents: ServiceOperationsIncident[] = [
  { id: 'INC-2048', service: 'Checkout API', summary: 'Elevated payment failures', severity: 'Critical', status: 'Investigating', owner: 'Mina Seo', age: '18m', region: 'us-east-1' },
  { id: 'INC-2047', service: 'Search', summary: 'Indexing queue delay', severity: 'High', status: 'Monitoring', owner: 'Alex Chen', age: '42m', region: 'eu-west-1' },
  { id: 'INC-2046', service: 'Identity', summary: 'Intermittent login timeouts', severity: 'Medium', status: 'Investigating', owner: 'Sarah Kim', age: '1h 12m', region: 'global' },
  { id: 'INC-2045', service: 'Notifications', summary: 'Email delivery degradation', severity: 'Low', status: 'Resolved', owner: 'Marcus Lee', age: '2h 08m', region: 'us-west-2' },
]

export function createServiceOperationsApi() {
  const incidents = initialIncidents.map((incident) => ({ ...incident }))
  const stats: ServiceOperationsApiStats = { incidentReads: 0, detailReads: 0, handoffWrites: 0 }

  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('content-type', 'application/json')

    if (url.pathname === '/incidents' && req.method === 'GET') {
      const status = url.searchParams.get('status')
      const id = url.searchParams.get('id')
      if (id) stats.detailReads++
      else stats.incidentReads++
      const rows = incidents.filter((incident) => (!status || status === 'all' || incident.status === status) && (!id || incident.id === id))
      res.end(JSON.stringify(rows))
      return
    }

    if (url.pathname === '/handoffs' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const handoff = body ? (JSON.parse(body) as Record<string, unknown>) : {}
          if (typeof handoff.owner !== 'string' || typeof handoff.note !== 'string') {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'owner and note are required' }))
            return
          }
          stats.handoffWrites++
          stats.lastHandoff = { ...handoff }
          res.end(JSON.stringify({ ...handoff, version: String(stats.handoffWrites) }))
        } catch {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'invalid JSON body' }))
        }
      })
      return
    }

    next()
  }

  return { middleware, stats }
}
