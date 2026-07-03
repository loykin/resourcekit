import type { ScopeOptions } from '@loykin/resourcekit'

export const scope: ScopeOptions = {
  apiVersions: ['loykin.dev/v1alpha1'],
  kinds: {
    include: ['DataBody', 'DataBodySummary', 'DataBodyTab', 'DataBodyGroup', 'DataBodyField', 'TableView', 'ChartView', 'FilterControl', 'PageTopBar'],
  },
  variables: { allow: ['range', 'service'] },
  datasources: { allow: ['metrics'] },
  maxDepth: 8,
}
