import type { ConnectionProvider, RegisteredConnection } from '@loykin/resourcekit'

/**
 * Stands in for a host's own connection store (e.g. a database table) —
 * connections known only to the host, not baked into this server's boot
 * code via `registry.registerConnection`. `registry.setConnectionProvider`
 * exists for exactly this: the registry checks its static map first, then
 * falls back to whatever this provider returns (test.md §12).
 */
export function createConnectionStore() {
  const connections = new Map<string, RegisteredConnection>()

  const provider: ConnectionProvider = {
    async getConnection(uid) {
      return connections.get(uid)
    },
    async listConnections() {
      return [...connections.values()]
    },
  }

  return {
    provider,
    add(connection: RegisteredConnection) {
      connections.set(connection.uid, connection)
    },
    remove(uid: string) {
      connections.delete(uid)
    },
  }
}
