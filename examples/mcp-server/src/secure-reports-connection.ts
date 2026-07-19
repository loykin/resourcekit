import type { RegisteredConnection, RestConnectionConfig } from '@loykin/resourcekit'

export interface SecureReportsEnvironment {
  RESOURCEKIT_SECURE_REPORTS_URL?: string
  RESOURCEKIT_SECURE_REPORTS_TOKEN?: string
}

export function createSecureReportsConnection(
  env: SecureReportsEnvironment,
  defaults: SecureReportsEnvironment = {},
): RegisteredConnection<RestConnectionConfig> {
  const baseUrl = env.RESOURCEKIT_SECURE_REPORTS_URL ?? defaults.RESOURCEKIT_SECURE_REPORTS_URL
  const token = env.RESOURCEKIT_SECURE_REPORTS_TOKEN ?? defaults.RESOURCEKIT_SECURE_REPORTS_TOKEN
  if (!baseUrl) throw new Error('RESOURCEKIT_SECURE_REPORTS_URL is required')
  if (!token) throw new Error('RESOURCEKIT_SECURE_REPORTS_TOKEN is required')

  return {
    uid: 'secure-reports',
    type: 'rest',
    name: 'Secure Reports API',
    description: 'Auth-gated reports connection configured from server-owned environment values.',
    config: { baseUrl, headers: { authorization: `Bearer ${token}` } },
    policy: { methods: ['GET'], pathPrefixes: ['/secure'] },
    mcpPolicy: { test: true, preview: true, mutate: false, maxRows: 20 },
  }
}
