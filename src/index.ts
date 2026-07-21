/**
 * @loykin/resourcekit — headless core.
 * No React imports allowed anywhere under this entry.
 * Design rules: AGENTS.md
 */

export type {
  JsonSchema,
  DataRef,
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
} from './types'

export { createRegistry } from './registry'
export type { ResourceRegistry, ScopedRegistry } from './registry'

export { validateResource, validateResourceDocument, validateAllExamples } from './validation'
export type { ExampleValidationFailure } from './validation'
export { buildDocumentSchema, buildResourceDocumentSchema, nextStage, nextStageBatch, singleKindSchema } from './schema'
export type { BuildResourceDocumentSchemaOptions } from './schema'

export { createVariableEngine, scanVariableRefs, interpolate } from './variables'
export type { VariableEngine } from './variables'

export { restResolver, staticResolver, createConnectionDataResolver, createRestResolver } from './resolvers'
export type { RestResolverOptions } from './resolvers'
export { restConnectionAdapter, createRestConnectionAdapter } from './connectionAdapters'
export type { RestConnectionConfig, RestConnectionRequest, RestConnectionAdapterOptions } from './connectionAdapters'

export { getValueAtPath, setValueAtPath, coerceVariableValue } from './path'
export { runSubmit, SUBMIT_CANCELLED } from './submit'
export type { SubmitRuntime, SubmitResult } from './submit'

export { LOCKED_ANNOTATION, isLocked, markLocked, preserveLockedNodes } from './annotations'
export { canonicalizeJson, canonicalizeResource, canonicalStringify } from './canonical'

export {
  createDataflowRuntime,
  createMemoryDataStore,
  isDataRef,
  scanDataRefs,
  resolveDataRefs,
  validateDataGraph,
  clampQueryPolicy,
  DataGraphValidationError,
} from './dataflow'
export type {
  StateDataNode,
  ResolveDataNode,
  DataNode,
  DataGraphSpec,
  ResourceDocument,
  DataStatus,
  DataSnapshot,
  FetchStatus,
  DataStore,
  DataGraphIssue,
  DataGraphValidationResult,
  DataNodeResolveContext,
  CreateDataflowRuntimeOptions,
  DataflowRuntime,
  QueryPolicy,
  PublishResult,
  StatePatch,
} from './dataflow'

export { createDirectQueryCoordinator } from './queryCoordinator'
export type { QueryRequest, QueryStatus, QuerySnapshot, QueryHandle, QueryCoordinator } from './queryCoordinator'
