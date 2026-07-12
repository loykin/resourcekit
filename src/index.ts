/**
 * @loykin/resourcekit — headless core.
 * No React imports allowed anywhere under this entry.
 * Design rules: AGENTS.md
 */

export type {
  JsonSchema,
  Resource,
  Metadata,
  Slot,
  SlotPolicy,
  SlotRule,
  BehaviorPolicy,
  EventPolicy,
  VariableDeclaration,
  VariableValue,
  DataBinding,
  DatasourceBinding,
  RestBinding,
  StaticBinding,
  TimeRange,
  DataResolveContext,
  DataResolver,
  MutationBinding,
  MutationResolver,
  SubmitSpec,
  SubmitEffect,
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

export { validateResource } from './validation'
export { buildDocumentSchema, nextStage, nextStageBatch, singleKindSchema } from './schema'

export { createVariableEngine, scanVariableRefs, interpolate } from './variables'
export type { VariableEngine } from './variables'

export { restResolver, staticResolver } from './resolvers'

export { getValueAtPath, coerceVariableValue } from './path'
export { runSubmit } from './submit'
export type { SubmitRuntime } from './submit'
