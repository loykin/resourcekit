import type { Resource } from '@loykin/resourcekit'
import customerCrmExpected from '../scenarios/customer-crm/expected-resource.json'
import { scope as customerCrmScope } from '../scenarios/customer-crm/schema-scope'
import settingsFormExpected from '../scenarios/settings-form/expected-resource.json'
import { scope as settingsFormScope } from '../scenarios/settings-form/schema-scope'
import metricsDashboardExpected from '../scenarios/metrics-dashboard/expected-resource.json'
import { scope as metricsDashboardScope } from '../scenarios/metrics-dashboard/schema-scope'

// These are the same fixtures the root-level `pnpm scenario:eval` harness
// (playground/scenarios/*) grades AI-generated documents against — imported
// directly instead of a hand-duplicated copy, so the two can't drift apart
// the way they previously did (one got flattened to DetailView/FormView, the
// other didn't, and looked like a real bug until traced back to this).
export const customerCrmScenario = customerCrmExpected as Resource
export const settingsFormScenario = settingsFormExpected as Resource
export const metricsDashboardScenario = metricsDashboardExpected as Resource

export const scenarioExamples = [
  {
    id: 'scenario-customer-crm',
    name: 'Scenario / Customer CRM',
    description: 'Scenario fixture: list/detail selection, filter variable, detail summary, and chart.',
    category: 'scenario',
    evidence: 'scenario-test',
    scope: customerCrmScope,
    resource: customerCrmScenario,
  },
  {
    id: 'scenario-settings-form',
    name: 'Scenario / Settings form',
    description: 'Scenario fixture: data body sections with form-local state and declarative submit.',
    category: 'scenario',
    evidence: 'scenario-test',
    scope: settingsFormScope,
    resource: settingsFormScenario,
  },
  {
    id: 'scenario-metrics-dashboard',
    name: 'Scenario / Metrics dashboard',
    description: 'Scenario fixture: tabbed metrics body with summary, table, and chart.',
    category: 'scenario',
    evidence: 'scenario-test',
    scope: metricsDashboardScope,
    resource: metricsDashboardScenario,
  },
] as const
