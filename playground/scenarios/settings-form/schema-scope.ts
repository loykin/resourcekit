import type { ScopeOptions } from '../../../src'

export const scope: ScopeOptions = {
  apiVersions: ['resourcekit.dev/v1alpha1'],
  kinds: {
    include: ['DataBody', 'FormView', 'PageTopBar', 'ActionButton'],
  },
  actions: { allow: ['saveSettings'] },
  maxDepth: 8,
  rootLevels: ['template'],
}
