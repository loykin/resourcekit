import type { ScopeOptions } from '../../../src'

export const scope: ScopeOptions = {
  apiVersions: ['loykin.dev/v1alpha1'],
  kinds: {
    include: [
      'ListDetail',
      'PageTopBar',
      'SelectableList',
      'TableView',
      'DataBody',
      'DataBodySummary',
      'DataBodyGroup',
      'DataBodyField',
      'ChartView',
      'FilterControl',
      'ActionButton',
    ],
  },
  variables: { allow: ['customerId', 'status'] },
  datasources: { allow: ['crm'] },
  maxDepth: 8,
}
