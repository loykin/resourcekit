/**
 * @loykin/resourcekit — headless core.
 * No React imports allowed anywhere under this entry.
 * Spec: docs/loykin-resource-runtime.md
 */

export type {
  JsonSchema,
  LoykinResource,
  LoykinMetadata,
  LoykinSlot,
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
  LoykinKindManifest,
  ResourceKitPlugin,
  ScopeOptions,
  ValidationIssue,
  ValidationResult,
} from './types'

export { createRegistry } from './registry'
export type { ResourceRegistry, ScopedRegistry } from './registry'

export { validateResource } from './validation'
export { buildDocumentSchema } from './schema'

export { createVariableEngine, scanVariableRefs, interpolate } from './variables'
export type { VariableEngine } from './variables'

export { restResolver, staticResolver } from './resolvers'
