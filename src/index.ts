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
  MutationBinding,
  MutationResolver,
  SubmitSpec,
  SubmitEffect,
  FieldSpec,
  FilterSpec,
  ActionSpec,
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
} from './types'

export { createRegistry } from './registry'
export type { ResourceRegistry, ScopedRegistry } from './registry'

export { validateResource, validateResourceDocument } from './validation'
export { buildDocumentSchema, buildResourceDocumentSchema, nextStage, nextStageBatch, singleKindSchema } from './schema'

export { createVariableEngine, scanVariableRefs, interpolate } from './variables'
export type { VariableEngine } from './variables'

export { restResolver, staticResolver, createConnectionDataResolver } from './resolvers'
export { restConnectionAdapter } from './connectionAdapters'
export type { RestConnectionConfig, RestConnectionRequest } from './connectionAdapters'

export { getValueAtPath, coerceVariableValue } from './path'
export { runSubmit } from './submit'
export type { SubmitRuntime } from './submit'

export {
  createDataflowRuntime,
  createMemoryDataStore,
  isDataRef,
  scanDataRefs,
  resolveDataRefs,
  validateDataGraph,
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
  DataStore,
  DataGraphIssue,
  DataGraphValidationResult,
  DataNodeResolveContext,
  CreateDataflowRuntimeOptions,
  DataflowRuntime,
} from './dataflow'
