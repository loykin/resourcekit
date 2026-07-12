import type { ScopeOptions } from '../../../src'

export const scope: ScopeOptions = {
  apiVersions: ['resourcekit.dev/v1alpha1'],
  kinds: {
    include: ['DataBody', 'DataBodySummary', 'DataBodyTab', 'DataBodyGroup', 'DataBodyField', 'TableView', 'ChartView', 'FilterControl', 'PageTopBar'],
  },
  variables: { allow: ['range', 'service'] },
  datasources: { allow: ['metrics'] },
  maxDepth: 8,
  rootLevels: ['template'],
}
