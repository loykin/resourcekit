import type { ScopeOptions } from '../../../src'

export const scope: ScopeOptions = {
  apiVersions: ['resourcekit.dev/v1alpha1'],
  kinds: {
    include: [
      'ListDetail',
      'PageTopBar',
      'SelectableList',
      'TableView',
      'DataBody',
      'DetailView',
      'ChartView',
      'FilterControl',
      'ActionButton',
    ],
  },
  variables: { allow: ['customerId', 'status'] },
  datasources: { allow: ['crm'] },
  maxDepth: 8,
  rootLevels: ['template'],
}
