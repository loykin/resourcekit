import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Same demo dataset/routes as examples/mcp-server/src/demo-api.ts, mounted
 * as Vite dev-server middleware (same origin as the page, so no CORS/process
 * management needed) instead of a standalone http.Server — lets the
 * playground register a real `rest` connection (see App.tsx) and actually
 * fetch through it, the same way examples/mcp-server does.
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

export function demoUsersMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  res.setHeader('content-type', 'application/json')

  const oneMatch = url.pathname.match(/^\/users\/([^/]+)$/)

  if (url.pathname === '/users' && req.method === 'GET') {
    res.end(JSON.stringify(users))
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

  next()
}
