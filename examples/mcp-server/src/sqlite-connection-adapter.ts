import type { ConnectionAdapter, JsonSchema } from '@loykin/resourcekit'
import type { DatabaseSync } from 'node:sqlite'

/**
 * A custom, host-written ConnectionAdapter for a backend resourcekit has no
 * built-in support for — proves the contract is genuinely pluggable, not
 * REST-specific (test.md §5.2: "rest / datasourcekit / graphql / static /
 * custom"). Table/column identifiers can't be parameterized in SQL, so they
 * go through an allowlist + a strict identifier regex instead — only `where`
 * *values* are passed as bound parameters.
 */

export interface SqliteConnectionConfig {
  db: DatabaseSync
  /** Table allowlist — the only tables this connection may query. */
  tables: string[]
}

export interface SqliteConnectionRequest {
  table: string
  where?: Record<string, string | number>
  limit?: number
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function quoteIdent(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`invalid identifier: ${name}`)
  return `"${name}"`
}

function checkPolicy(tables: string[], request: SqliteConnectionRequest): string[] {
  const issues: string[] = []
  if (!IDENTIFIER.test(request.table) || !tables.includes(request.table)) {
    issues.push(`table ${request.table} is not allowed for this connection`)
  }
  for (const column of Object.keys(request.where ?? {})) {
    if (!IDENTIFIER.test(column)) issues.push(`invalid filter column: ${column}`)
  }
  return issues
}

function runQuery(db: DatabaseSync, request: SqliteConnectionRequest): Record<string, unknown>[] {
  const conditions = Object.keys(request.where ?? {})
  const sql =
    `SELECT * FROM ${quoteIdent(request.table)}` +
    (conditions.length ? ` WHERE ${conditions.map((column) => `${quoteIdent(column)} = ?`).join(' AND ')}` : '')
  const rows = db.prepare(sql).all(...Object.values(request.where ?? {})) as Record<string, unknown>[]
  return request.limit ? rows.slice(0, request.limit) : rows
}

function columnsOf(db: DatabaseSync, table: string): Array<{ name: string; type: string }> {
  return db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string; type: string }>
}

function schemaFromColumns(columns: Array<{ name: string; type: string }>): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  for (const column of columns) {
    const sqlType = column.type.toLowerCase()
    properties[column.name] = { type: sqlType.includes('int') || sqlType.includes('real') ? 'number' : 'string' }
  }
  return { type: 'object', properties }
}

const requestSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['table'],
  properties: {
    table: { type: 'string' },
    where: { type: 'object' },
    limit: { type: 'number' },
  },
}

export const sqliteConnectionAdapter: ConnectionAdapter<SqliteConnectionConfig, SqliteConnectionRequest> = {
  type: 'sqlite',
  requestSchema,

  async test(connection) {
    const start = Date.now()
    try {
      connection.config.db.prepare('SELECT 1').get()
      return { ok: true, latencyMs: Date.now() - start }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'query failed', latencyMs: Date.now() - start }
    }
  },

  async inspect(connection, request) {
    const { db, tables } = connection.config
    if (!request.path) return { namespaces: tables }
    if (!tables.includes(request.path)) throw new Error(`table ${request.path} is not allowed for this connection`)
    return { fields: columnsOf(db, request.path).map((column) => ({ name: column.name, type: column.type })) }
  },

  async validate(connection, request) {
    const issues = checkPolicy(connection.config.tables, request)
    return issues.length === 0 ? { valid: true } : { valid: false, issues }
  },

  async preview(connection, request) {
    const issues = checkPolicy(connection.config.tables, request)
    if (issues.length > 0) throw new Error(issues.join('; '))

    const start = Date.now()
    const rows = runQuery(connection.config.db, request)
    const maxRows = connection.mcpPolicy?.maxRows ?? 20
    const limited = rows.slice(0, maxRows)
    return {
      schema: schemaFromColumns(columnsOf(connection.config.db, request.table)),
      rows: limited,
      stats: { returnedRows: limited.length, totalRows: rows.length, executionTimeMs: Date.now() - start },
      truncated: rows.length > limited.length,
    }
  },

  async resolve(connection, request) {
    const issues = checkPolicy(connection.config.tables, request)
    if (issues.length > 0) throw new Error(issues.join('; '))
    return runQuery(connection.config.db, request)
  },
}
