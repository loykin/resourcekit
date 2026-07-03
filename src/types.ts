/**
 * Core contract types for the Loykin resource runtime.
 * The contract mirrors the resource runtime design (see AGENTS.md).
 * This module must stay framework-free (no React imports).
 */

// ─── JSON Schema ──────────────────────────────────────────────────────────────

/** Structural alias — schema fragments are plain JSON Schema objects. */
export type JsonSchema = Record<string, unknown>

// ─── Resource envelope ────────────────────────────────────────────────────────

export interface LoykinResource<TSpec = unknown> {
  apiVersion: string
  kind: string
  metadata?: LoykinMetadata
  spec: TSpec
  slots?: LoykinSlot[]
}

export interface LoykinMetadata {
  name?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
}

/** Parent-owned placement group. `name` is omitted for the default slot. */
export interface LoykinSlot {
  name?: string
  children: LoykinResource[]
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

export type DataBinding =
  | DatasourceBinding
  | RestBinding
  | StaticBinding
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

// ─── Kind manifest ────────────────────────────────────────────────────────────

/**
 * `render` is framework-specific and therefore generic here. The react
 * adapter narrows TRender to its renderer signature. `load` supports lazy
 * (code-split) renderers — schema and validation never wait on it.
 */
export interface LoykinKindManifest<TSpec = unknown, TRender = unknown> {
  apiVersion: string
  kind: string
  specSchema: JsonSchema
  slotPolicy?: SlotPolicy
  behaviorPolicy?: BehaviorPolicy
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
  kinds?: LoykinKindManifest<unknown, TRender>[]
  dataResolvers?: Record<string, DataResolver>
  mutationResolvers?: Record<string, MutationResolver>
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
  maxDepth?: number
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
