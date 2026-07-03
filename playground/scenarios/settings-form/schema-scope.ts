import type { ScopeOptions } from '@loykin/resourcekit'

export const scope: ScopeOptions = {
  apiVersions: ['loykin.dev/v1alpha1'],
  kinds: {
    include: ['DataBody', 'DataBodySection', 'DataBodyGroup', 'DataBodyRow', 'InputControl', 'ResourceForm', 'PageTopBar', 'ActionButton'],
  },
  actions: { allow: ['saveSettings'] },
  maxDepth: 8,
}
