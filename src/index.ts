/**
 * @loykin/resourcekit — headless core.
 * No React imports allowed anywhere under this entry.
 * Design rules: AGENTS.md
 */

export type {
  JsonSchema,
  ScopeRef,
  ObjectStateRef,
  ObjectStateDeclaration,
  ScopeSpec,
  QueryPolicy,
  VariableRef,
  ValueBinding,
  Resource,
  VisibilityCondition,
  Metadata,
  Slot,
  SlotPolicy,
  SlotRule,
  BehaviorPolicy,
  BindingPort,
  BindingPolicy,
  EventPolicy,
  VariableDeclaration,
  VariableValue,
  DataBinding,
  DatasourceBinding,
  RestBinding,
  StaticBinding,
  ConnectionBinding,
  TimeRange,
  DataResolveContext,
  DataResolver,
  DataSourceAdapter,
  MutationBinding,
  MutationResolver,
  ConfirmSpec,
  SubmitSpec,
  SubmitEffect,
  FieldSpec,
  FilterSpec,
  ActionSpec,
  RowCondition,
  ViewStateSpec,
  ConnectionPolicy,
  ConnectionMcpPolicy,
  RegisteredConnection,
  ConnectionProvider,
  ConnectionContext,
  ConnectionTestResult,
  ConnectionInspectRequest,
  ConnectionInspection,
  RequestValidationResult,
  DataPreview,
  ConnectionAdapter,
  ConnectionSummary,
  KindManifest,
  ResourceKitPlugin,
  ScopeOptions,
  ValidationIssue,
  ValidationResult,
  StagePosition,
  StageResult,
  StageBatchPosition,
  StageBatchResult,
  QueryScopePolicy,
  KindExample,
  PatternExample,
  SelectedKindExample,
  SelectedExamples,
} from './core/types'

export { createRegistry } from './core/registry'
export type { ResourceRegistry, ScopedRegistry } from './core/registry'

export { validateResource, validateAllExamples } from './core/validation'
export type { ExampleValidationFailure } from './core/validation'
export { buildDocumentSchema, nextStage, nextStageBatch, singleKindSchema } from './core/schema'

export { createVariableEngine, scanVariableRefs, interpolate } from './runtime/variables'
export type { VariableEngine } from './runtime/variables'
export { createMemoryRuntimeStore, runtimeKeys } from './runtime/store'
export type {
  RuntimeNamespace,
  RuntimeOrigin,
  RuntimeKey,
  RuntimeStatus,
  RuntimeSnapshot,
  RuntimeSnapshotUpdate,
  RuntimeMutationOptions,
  RuntimeSelector,
  RuntimeChange,
  RuntimeStore,
  FetchStatus,
} from './runtime/store'
export { restResolver, staticResolver, createConnectionDataResolver, createRestResolver } from './connection/resolvers'
export type { RestResolverOptions } from './connection/resolvers'
export { restConnectionAdapter, createRestConnectionAdapter } from './connection/connectionAdapters'
export type { RestConnectionConfig, RestConnectionRequest, RestConnectionAdapterOptions } from './connection/connectionAdapters'

export { getValueAtPath, setValueAtPath, coerceVariableValue } from './core/path'
export { runSubmit, SUBMIT_CANCELLED } from './runtime/submit'
export type { SubmitRuntime, SubmitResult } from './runtime/submit'

export { LOCKED_ANNOTATION, isLocked, markLocked, preserveLockedNodes } from './core/annotations'
export { canonicalizeJson, canonicalizeResource, canonicalStringify } from './core/canonical'

export { clampQueryPolicy } from './runtime/queryPolicy'
export { isScopeRef, scanScopeRefs } from './runtime/scopeRef'
export { isObjectStateRef, scanObjectStateRefs, createObjectStateEngine } from './runtime/objectState'
export type { ObjectStateEngine } from './runtime/objectState'
export { createScopeRegistry } from './runtime/scopeRegistry'
export type { ScopeRegistry, ScopeRegistration } from './runtime/scopeRegistry'

export { createDirectQueryCoordinator } from './runtime/queryCoordinator'
export type { QueryRequest, QueryStatus, QuerySnapshot, QueryHandle, QueryCoordinator } from './runtime/queryCoordinator'
