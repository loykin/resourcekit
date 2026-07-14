import { tableFrameToRows } from '@loykin/datasourcekit'
import type { DatasourceContext, DatasourceFrame, DatasourceManager } from '@loykin/datasourcekit'
import type { ConnectionAdapter, ConnectionContext, DataResolveContext, JsonSchema } from '../../types'

/**
 * DatasourceKit is a frontend contract layer, not a datasource type itself —
 * one `DatasourceManager` fronts many plugin-defined types (postgres,
 * clickhouse, prometheus, ...). A registered connection identifies one
 * instance within it (test.md §8.2).
 */
export interface DatasourceKitConnectionConfig {
  datasourceUid: string
  datasourceType: string
}

interface TableColumn {
  name: string
  type?: string
}

function tableFromFrame(frame: DatasourceFrame): { columns: TableColumn[]; rows: Record<string, unknown>[] } {
  const table = tableFrameToRows(frame)
  return {
    columns: table.columns,
    rows: table.rows.map((row) => Object.fromEntries(table.columns.map((column, index) => [column.name, row[index]]))),
  }
}

function jsonSchemaType(type: string | undefined): string {
  switch (type) {
    case 'number':
    case 'integer':
    case 'float':
    case 'double':
      return 'number'
    case 'boolean':
    case 'bool':
      return 'boolean'
    default:
      return 'string'
  }
}

function columnsToSchema(columns: TableColumn[]): JsonSchema {
  return { type: 'object', properties: Object.fromEntries(columns.map((column) => [column.name, { type: jsonSchemaType(column.type) }])) }
}

function toDatasourceContext(context: ConnectionContext | DataResolveContext): DatasourceContext {
  const resolveContext = context as Partial<DataResolveContext>
  const variables = resolveContext.variables
    ? (Object.fromEntries(Object.entries(resolveContext.variables).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)) as Record<
        string,
        string | string[]
      >)
    : undefined
  return { signal: context.signal, variables, timeRange: resolveContext.timeRange }
}

let requestCounter = 0

/**
 * Bridges `ConnectionAdapter` to a `DatasourceManager.instances` API
 * (test.md §8.2): `test` -> `healthCheck`, `inspect` -> `listNamespaces` /
 * `listFields`, `validate` -> `validateQuery`, `preview`/`resolve` ->
 * `query`. Query shape (`TRequest`) is plugin-specific — DatasourceKit
 * itself doesn't enforce one (see its README), so `requestSchema` stays
 * opaque and real validation goes through `validate()` against the live
 * backend instead of a static schema.
 *
 * Only the first `QueryResult.frame` is used — resourcekit's `DataResolver`
 * contract is a single flat rows array (test.md §12: richer multi-frame
 * shapes are a later additive extension, not v1).
 */
export function createDatasourceKitConnectionAdapter(manager: DatasourceManager): ConnectionAdapter<DatasourceKitConnectionConfig, unknown> {
  return {
    type: 'datasourcekit',
    requestSchema: { type: 'object' },

    async test(connection, context) {
      const result = await manager.instances.healthCheck(connection.config.datasourceUid, connection.config.datasourceType, toDatasourceContext(context))
      return { ok: result.ok, message: result.message }
    },

    async inspect(connection, request, context) {
      const ctx = toDatasourceContext(context)
      if (!request.path) {
        const namespaces = await manager.instances.listNamespaces(connection.config.datasourceUid, connection.config.datasourceType, ctx)
        return { namespaces: namespaces.map((namespace) => namespace.id) }
      }
      const fields = await manager.instances.listFields(connection.config.datasourceUid, connection.config.datasourceType, { namespaceId: request.path }, ctx)
      return { fields: fields.map((field) => ({ name: field.name, type: field.type })) }
    },

    async validate(connection, request, context) {
      const result = await manager.instances.validateQuery(connection.config.datasourceUid, connection.config.datasourceType, request, toDatasourceContext(context))
      return { valid: result.valid, issues: result.errors }
    },

    async preview(connection, request, context) {
      const start = Date.now()
      const maxRows = connection.mcpPolicy?.maxRows
      const result = await manager.instances.query(
        {
          id: `resourcekit-preview-${++requestCounter}`,
          datasourceUid: connection.config.datasourceUid,
          datasourceType: connection.config.datasourceType,
          query: request,
          options: maxRows === undefined ? undefined : { maxRows },
        },
        toDatasourceContext(context),
      )
      const frame = result.frames[0]
      const table = frame ? tableFromFrame(frame) : { columns: [], rows: [] }
      const rows = maxRows === undefined ? table.rows : table.rows.slice(0, maxRows)
      return {
        schema: columnsToSchema(table.columns),
        rows,
        stats: { returnedRows: rows.length, executionTimeMs: result.stats?.executionTimeMs ?? Date.now() - start },
        truncated: rows.length < table.rows.length,
      }
    },

    async resolve(connection, request, context) {
      const result = await manager.instances.query(
        {
          id: `resourcekit-${++requestCounter}`,
          datasourceUid: connection.config.datasourceUid,
          datasourceType: connection.config.datasourceType,
          query: request,
        },
        toDatasourceContext(context),
      )
      const frame = result.frames[0]
      return frame ? tableFromFrame(frame).rows : []
    },
  }
}
