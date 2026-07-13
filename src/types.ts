/**
 * Core contract types for the Loykin resource runtime.
 * The contract mirrors the resource runtime design (see AGENTS.md).
 * This module must stay framework-free (no React imports).
 */

// ─── JSON Schema ──────────────────────────────────────────────────────────────

/** Structural alias — schema fragments are plain JSON Schema objects. */
export type JsonSchema = Record<string, unknown>

// ─── Resource envelope ────────────────────────────────────────────────────────

export interface Resource<TSpec = unknown> {
  apiVersion: string
  kind: string
  metadata?: Metadata
  spec: TSpec
  slots?: Slot[]
}

export interface Metadata {
  name?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
}

/** Parent-owned placement group. `name` is omitted for the default slot. */
export interface Slot {
  name?: string
  items: Resource[]
}

// ─── Slot policy ──────────────────────────────────────────────────────────────

export interface SlotPolicy {
  defaultSlot?: SlotRule
  slots?: Record<string, SlotRule>
}

export interface SlotRule {
  min?: number
  max?: number
  /** Allowed child kind names. Omit to accept any registered kind. */
  accepts?: string[]
  /**
   * Allowed child composition levels (see `KindManifest.level`). A
   * child matches if its `level` intersects this set. Unions with `accepts`
   * — a child is allowed if it matches either. Omit both to accept any
   * registered kind.
   */
  acceptsLevels?: string[]
  /**
   * What this slot is for, in plain language (e.g. "secondary filters and
   * navigation, rendered left of mainPane"). Surfaced as JSON Schema
   * `description` on the generated slot branch — the schema otherwise only
   * tells the AI which kinds are structurally valid here, not what the slot
   * means, which matters most when sibling slots accept the same levels.
   */
  description?: string
}

// ─── Behavior policy ──────────────────────────────────────────────────────────

export interface BehaviorPolicy {
  state?: 'internal' | 'external' | 'controlled'
  events?: Record<string, EventPolicy>
}

export type EventPolicy =
  | { kind: 'internal' }
  | { kind: 'emit'; event: string }
  | { kind: 'action'; action: string }
  | { kind: 'setVariable'; variable: string; from?: string }

// ─── Variables ────────────────────────────────────────────────────────────────

export interface VariableDeclaration {
  name: string
  type?: 'string' | 'string[]'
  default?: string | string[]
  /** `url` syncs to a query param; `none` is transient UI state. Default: none. */
  persist?: 'url' | 'none'
}

export type VariableValue = string | string[] | undefined

// ─── Data bindings (read path) ────────────────────────────────────────────────

export interface DatasourceBinding<TQuery = unknown> {
  source: 'datasource'
  datasourceUid: string
  datasourceType?: string
  query?: TQuery
  options?: Record<string, unknown>
  cacheTtlMs?: number
  staleWhileRevalidate?: boolean
  /** Dot-path applied by the runtime after the resolver returns rows. */
  valuePath?: string
}

export interface RestBinding {
  source: 'rest'
  url: string
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  /** JSON path to the rows array in the response, e.g. "data.items". */
  rowsPath?: string
  /** Dot-path applied by the runtime after the resolver returns rows. */
  valuePath?: string
}

export interface StaticBinding {
  source: 'static'
  rows: Record<string, unknown>[]
  /** Dot-path applied by the runtime after the resolver returns rows. */
  valuePath?: string
}

/**
 * References a registered connection (see `ConnectionAdapter`/`RegisteredConnection`
 * below) by UID instead of embedding a raw URL/DSN. `request` is opaque here —
 * its shape is defined by the connection's adapter (`ConnectionAdapter.requestSchema`).
 */
export interface ConnectionBinding {
  source: 'connection'
  connection: string
  request: unknown
  /** Dot-path applied by the runtime after the resolver returns rows. */
  valuePath?: string
}

export type DataBinding =
  | DatasourceBinding
  | RestBinding
  | StaticBinding
  | ConnectionBinding
  | { source: string; [key: string]: unknown }

export interface TimeRange {
  from: string
  to: string
  raw?: { from: string; to: string }
}

export interface DataResolveContext {
  variables: Record<string, VariableValue>
  timeRange?: TimeRange
  signal?: AbortSignal
  meta?: Record<string, unknown>
}

/** v1 output contract is plain rows. Richer shapes (frames) are an additive later union. */
export type DataResolver = (
  binding: DataBinding,
  ctx: DataResolveContext,
) => Promise<Record<string, unknown>[]>

// ─── Mutation bindings (write path) ──────────────────────────────────────────

export type MutationBinding =
  | {
      target: 'rest'
      url: string
      method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      headers?: Record<string, string>
    }
  | { target: 'datasource'; datasourceUid: string; mutation?: unknown }
  | { target: string; [key: string]: unknown }

export type MutationResolver = (
  binding: MutationBinding,
  payload: unknown,
  ctx: DataResolveContext,
) => Promise<unknown>

/**
 * Effect applied after a successful mutation.
 * setVariable: `value` sets a literal, `from` reads a dot-path from the
 * result, neither clears the variable (useful for closing popups).
 * emit: surfaces the mutation result to the host app (ResourceRenderer onEvent).
 */
export type SubmitEffect =
  | { kind: 'setVariable'; variable: string; from?: string; value?: string | string[] }
  | { kind: 'emit'; event: string }

/**
 * Declarative submit wiring for forms and editable cells:
 * an action name (gated by the scoped action allowlist), the mutation
 * binding to execute, and post-success effects. A variable touched by
 * `onSuccess` re-triggers dependent data bindings through normal reactivity.
 */
export interface SubmitSpec {
  action?: string
  mutation: MutationBinding
  onSuccess?: SubmitEffect[]
}

// ─── Common spec fragments ───────────────────────────────────────────────────
// Shared vocabulary reused across view kinds (DetailView, TableView, ...) so
// field/filter/action syntax doesn't drift between them. See
// docs design note test.md §3.2.

export interface FieldSpec {
  field: string
  label?: string
  display?: 'text' | 'number' | 'date' | 'badge' | 'boolean'
  format?: string
  align?: 'left' | 'center' | 'right'
  emphasis?: 'normal' | 'strong'
}

export interface FilterSpec {
  name: string
  label?: string
  type: 'text' | 'select' | 'date' | 'dateRange'
  variable: string
  options?: Array<{ label: string; value: string }>
}

export interface ActionSpec {
  id: string
  label: string
  action?: string
  mutation?: MutationBinding
  confirm?: {
    title: string
    description?: string
  }
}

/** Messages shown for a view's empty/error states; omitted fields fall back to the kind's default copy. */
export interface ViewStateSpec {
  emptyMessage?: string
  errorMessage?: string
}

// ─── Connections ──────────────────────────────────────────────────────────────
// See docs design note test.md §5. ResourceKit registers connection capability
// and dispatches through it; it never owns credential storage, connection
// pools, or query editing (test.md §5.1).

/** Registration-time request/method restrictions; adapter-specific shape. */
export interface ConnectionPolicy {
  methods?: string[]
  pathPrefixes?: string[]
}

/**
 * Per-connection MCP exposure limits (test.md §9). Capability flags default to
 * `true` for read operations (test/inspect/preview) and `false` for `mutate` —
 * write access must be opted into explicitly.
 */
export interface ConnectionMcpPolicy {
  test?: boolean
  inspect?: boolean
  preview?: boolean
  mutate?: boolean
  maxRows?: number
  timeoutMs?: number
  maxResponseBytes?: number
}

/** A registered connection instance, e.g. `crm-api`. `config` carries adapter-specific secrets/URLs and is never sent to MCP — see `ConnectionSummary`. */
export interface RegisteredConnection<TConfig = unknown> {
  uid: string
  type: string
  name: string
  description?: string
  config: TConfig
  policy?: ConnectionPolicy
  mcpPolicy?: ConnectionMcpPolicy
}

export interface ConnectionContext {
  signal?: AbortSignal
}

export interface ConnectionTestResult {
  ok: boolean
  message?: string
  latencyMs?: number
}

export interface ConnectionInspectRequest {
  path?: string
}

export interface ConnectionInspection {
  schema?: JsonSchema
  fields?: Array<{ name: string; type?: string }>
  namespaces?: string[]
}

export interface RequestValidationResult {
  valid: boolean
  issues?: string[]
}

/** A capped, masked sample of what a request would return — never the full result set (test.md §7). */
export interface DataPreview {
  schema: JsonSchema
  rows: Record<string, unknown>[]
  stats?: {
    totalRows?: number
    returnedRows: number
    executionTimeMs?: number
  }
  truncated: boolean
}

/**
 * A connection *type's* common request vocabulary and execution (rest,
 * datasourcekit, graphql, ...). `resolve` is the render-time path; MCP-facing
 * `test`/`inspect`/`validate`/`preview` are optional so adapters that don't
 * support introspection can omit them (see `ConnectionSummary.capabilities`).
 */
export interface ConnectionAdapter<TConfig = unknown, TRequest = unknown> {
  type: string
  requestSchema: JsonSchema

  test?(connection: RegisteredConnection<TConfig>, context: ConnectionContext): Promise<ConnectionTestResult>

  inspect?(
    connection: RegisteredConnection<TConfig>,
    request: ConnectionInspectRequest,
    context: ConnectionContext,
  ): Promise<ConnectionInspection>

  validate?(connection: RegisteredConnection<TConfig>, request: TRequest, context: ConnectionContext): Promise<RequestValidationResult>

  preview?(connection: RegisteredConnection<TConfig>, request: TRequest, context: ConnectionContext): Promise<DataPreview>

  resolve(connection: RegisteredConnection<TConfig>, request: TRequest, context: DataResolveContext): Promise<Record<string, unknown>[]>
}

/**
 * The MCP/AI-facing view of a registered connection — `config` (base URL, DSN,
 * credentials) is deliberately absent (test.md §5.3). `capabilities` is the
 * effective intersection of adapter capability ∩ connection `mcpPolicy` ∩
 * scope capabilities (test.md §6), computed by `ScopedRegistry.listConnections()`.
 */
export interface ConnectionSummary {
  uid: string
  type: string
  name: string
  description?: string
  requestSchema: JsonSchema
  capabilities: {
    test: boolean
    inspect: boolean
    preview: boolean
    mutate: boolean
  }
}

// ─── Kind manifest ────────────────────────────────────────────────────────────

/**
 * `render` is framework-specific and therefore generic here. The react
 * adapter narrows TRender to its renderer signature. `load` supports lazy
 * (code-split) renderers — schema and validation never wait on it.
 */
export interface KindManifest<TSpec = unknown, TRender = unknown> {
  apiVersion: string
  kind: string
  specSchema: JsonSchema
  slotPolicy?: SlotPolicy
  behaviorPolicy?: BehaviorPolicy
  /**
   * Composition levels this kind is valid at (see docs/kind-level-taxonomy.md).
   * Most kinds carry exactly one tag; a kind that is both a whole-page
   * template and independently embeddable content (e.g. DataBody) carries
   * more than one. Used by `ScopeOptions.rootLevels` and `SlotRule.acceptsLevels`.
   */
  level?: string[]
  /**
   * What this kind is, in plain language, and — critically — when to use it
   * over a structurally similar sibling kind (e.g. DataBodyGroup vs.
   * DataBodySection vs. DataBodyTab all wrap children with a label/id and
   * are otherwise indistinguishable in the schema). Surfaced as JSON Schema
   * `description` on the kind's generated definition.
   */
  description?: string
  /**
   * When true, the runtime resolves `spec.data` to a single record
   * (first row) before rendering children, and publishes it to descendants
   * as the nearest record scope (`ctx.record`, `fieldRef` reads).
   */
  recordScope?: boolean
  render?: TRender
  load?: () => Promise<TRender>
  /** Phantom member so TSpec participates in inference; never set at runtime. */
  __spec?: TSpec
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export interface ResourceKitPlugin<TRender = unknown> {
  name: string
  kinds?: KindManifest<unknown, TRender>[]
  dataResolvers?: Record<string, DataResolver>
  mutationResolvers?: Record<string, MutationResolver>
  /** Connection *type* adapters (rest, datasourcekit, ...) — not registered connection instances, see `ResourceRegistry.registerConnection`. */
  connectionAdapters?: Record<string, ConnectionAdapter>
}

// ─── Scoped capabilities ──────────────────────────────────────────────────────

export interface ScopeOptions {
  apiVersions?: string[]
  kinds?: {
    include?: string[]
    exclude?: string[]
  }
  spec?: Record<
    string,
    {
      pick?: string[]
      omit?: string[]
      lock?: Record<string, unknown>
    }
  >
  slots?: Record<
    string,
    {
      include?: string[]
      exclude?: string[]
    }
  >
  variables?: {
    allow?: string[]
    lock?: Record<string, string | string[]>
  }
  datasources?: {
    allow?: string[]
  }
  actions?: {
    allow?: string[]
  }
  /** Restricts which registered connections (test.md §5.2) this scope exposes, and the capability ceiling applied to all of them (test.md §6). */
  connections?: {
    allow?: string[]
    capabilities?: {
      test?: boolean
      inspect?: boolean
      preview?: boolean
      mutate?: boolean
    }
  }
  maxDepth?: number
  /**
   * Allowed levels for the document root (see docs/kind-level-taxonomy.md).
   * The root is treated as the outermost implicit slot: a document is valid
   * only if its root kind's `level` intersects this set. Omit to leave the
   * root unrestricted (today's behavior).
   */
  rootLevels?: string[]
}

// ─── Staged schema requests ─────────────────────────────────────────────────
//
// Stateless "given what's already chosen, what's valid next" primitives.
// Intended to be called directly by whatever orchestrates generation (an MCP
// client's own tool-calling loop, a host application's own loop, etc.) —
// resourcekit deliberately doesn't ship an orchestration loop of its own; see
// docs/staged-generation-experiment.md for why.

/**
 * One position in the document tree to resolve — the root (omit `parent`),
 * or a specific slot on an already-chosen parent node.
 */
export interface StagePosition {
  parent?: {
    apiVersion: string
    kind: string
    /** Omit for the parent's defaultSlot. */
    slotName?: string
  }
}

/**
 * Result of resolving one `StagePosition`. Exactly one of `fixed`/`schema`
 * is set:
 * - `fixed`: this position has exactly one valid kind — insert it directly,
 *   no AI turn needed for the kind choice.
 * - `schema`: a self-contained JSON Schema (own `$defs`) scoped to just this
 *   position — envelope + spec for each candidate kind, not their slots.
 *   Recurse with a new `StagePosition` once a kind is chosen and its slots
 *   are known.
 */
export interface StageResult {
  fixed?: { apiVersion: string; kind: string }
  schema?: JsonSchema
}

/**
 * One already-resolved parent whose sibling slots should be resolved
 * together in a single request, instead of one `StagePosition` at a time.
 */
export interface StageBatchPosition {
  parent: { apiVersion: string; kind: string }
}

/**
 * Result of resolving every slot on a `StageBatchPosition.parent` at once.
 * - `fixed`: slotName -> the single valid kind for slots with no real
 *   choice — insert directly, no AI turn needed for these.
 * - `schema`: a self-contained object schema (own `$defs` where needed)
 *   covering every slot with real choice, one property per open slot name.
 *   Omitted if every slot is fixed or the parent has no slots. A
 *   non-repeatable slot's property is a candidate `oneOf` (envelope-only,
 *   no `spec`); a repeatable slot's property is a `oneOf`-item array with
 *   `minItems`/`maxItems`. Optional slots (`min` 0 or unset) are not in
 *   `required` — omitting the key means declining that slot.
 */
export interface StageBatchResult {
  fixed: Record<string, { apiVersion: string; kind: string }>
  schema?: JsonSchema
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationIssue {
  /** JSON-pointer-ish path into the document, e.g. "/slots/0/children/1/spec". */
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}
