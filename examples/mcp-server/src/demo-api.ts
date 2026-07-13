import { createServer } from 'node:http'

/**
 * A tiny in-memory REST API, purely so this example can demonstrate a
 * selection-driven detail view (RecordScope filtered by a variable) and a
 * real submit mutation — resourcekit's `static` data source can't be
 * filtered by a variable (it's a fixed inline array), so a client trying to
 * build that pattern against only `static`/`rest` with no real backend has
 * no way to actually complete it. This gives it one.
 */
interface DemoUser {
  id: string
  name: string
  email: string
  role: string
}

const users: DemoUser[] = [
  { id: '1', name: 'Alice Kim', email: 'alice@example.com', role: 'Engineer' },
  { id: '2', name: 'Bob Martinez', email: 'bob@example.com', role: 'Designer' },
  { id: '3', name: 'Carla Chen', email: 'carla@example.com', role: 'Manager' },
  { id: '4', name: 'David Osei', email: 'david@example.com', role: 'Engineer' },
]

/**
 * Requires `Authorization: Bearer <DEMO_API_TOKEN>` — exists purely to prove
 * a connection can carry a secret in its (never-MCP-visible) config.headers
 * and actually authenticate, test.md §5.3.
 */
export const DEMO_API_TOKEN = 'demo-secret-token-xyz'

const reports = [
  { quarter: 'Q1', revenue: 482000, headcount: 34 },
  { quarter: 'Q2', revenue: 511000, headcount: 37 },
]

export interface DemoApi {
  baseUrl: string
  close: () => void
}

export function startDemoApi(): Promise<DemoApi> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      res.setHeader('content-type', 'application/json')

      const oneMatch = url.pathname.match(/^\/users\/([^/]+)$/)

      if (url.pathname === '/users' && req.method === 'GET') {
        res.end(JSON.stringify(users))
        return
      }

      if (url.pathname === '/secure/reports' && req.method === 'GET') {
        if (req.headers.authorization !== `Bearer ${DEMO_API_TOKEN}`) {
          res.statusCode = 401
          res.end(JSON.stringify({ error: 'unauthorized' }))
          return
        }
        res.end(JSON.stringify(reports))
        return
      }

      if (oneMatch && req.method === 'GET') {
        const user = users.find((candidate) => candidate.id === oneMatch[1])
        if (!user) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'not found' }))
          return
        }
        res.end(JSON.stringify(user))
        return
      }

      if (oneMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          const user = users.find((candidate) => candidate.id === oneMatch[1])
          if (!user) {
            res.statusCode = 404
            res.end(JSON.stringify({ error: 'not found' }))
            return
          }
          try {
            const patch = body ? (JSON.parse(body) as Partial<DemoUser>) : {}
            Object.assign(user, patch)
            res.end(JSON.stringify(user))
          } catch {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'invalid JSON body' }))
          }
        })
        return
      }

      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}
