import customerCrmExpected from './customer-crm/expected-resource.json'
import { scope as customerCrmScope } from './customer-crm/schema-scope'
import { customers } from './customer-crm/seed-data'
import metricsDashboardExpected from './metrics-dashboard/expected-resource.json'
import { scope as metricsDashboardScope } from './metrics-dashboard/schema-scope'
import { metrics } from './metrics-dashboard/seed-data'
import settingsFormExpected from './settings-form/expected-resource.json'
import { scope as settingsFormScope } from './settings-form/schema-scope'
import { workspace } from './settings-form/seed-data'
import type { Resource } from '../../src'
import type { ScenarioDefinition } from './evaluation'

const customerCrmPrompt = `Build a customer CRM list/detail screen. The page should show a searchable customer list, preserve selected customer id in a variable, and show a detail panel with revenue status and a small chart.`

const settingsFormPrompt = `Build a workspace settings form with grouped fields, a top bar, and a submit action. The form state should stay local to the form until submit.`

const metricsDashboardPrompt = `Build a metrics dashboard with a top bar, a tabbed data body, a summary band, a table, and charts. Keep filters as declarative controls.`

export const scenarioDefinitions: Array<ScenarioDefinition<unknown>> = [
  {
    id: 'customer-crm',
    prompt: customerCrmPrompt,
    scope: customerCrmScope,
    seedData: { customers },
    expectedResource: customerCrmExpected as Resource,
    rubric: {
      requiredKinds: ['ListDetail', 'PageTopBar', 'SelectableList', 'DataBody', 'DetailView', 'ChartView', 'FilterControl'],
      requiredVariables: ['customerId', 'status'],
      requiredEvents: ['select', 'change'],
      requiredBindings: [{ source: 'datasource', datasourceUid: 'crm' }],
      requiredText: ['Customers', 'Customer detail', 'Status'],
      forbiddenKindPrefixes: ['DesignKit', 'GridKit', 'ChartKit', 'BaseKit'],
    },
  },
  {
    id: 'settings-form',
    prompt: settingsFormPrompt,
    scope: settingsFormScope,
    seedData: { workspace },
    expectedResource: settingsFormExpected as Resource,
    rubric: {
      requiredKinds: ['DataBody', 'PageTopBar', 'FormView'],
      requiredText: ['Workspace settings', 'Settings / Workspace', 'Save settings'],
      forbiddenKindPrefixes: ['DesignKit', 'GridKit', 'ChartKit', 'BaseKit'],
    },
  },
  {
    id: 'metrics-dashboard',
    prompt: metricsDashboardPrompt,
    scope: metricsDashboardScope,
    seedData: { metrics },
    expectedResource: metricsDashboardExpected as Resource,
    rubric: {
      requiredKinds: ['DataBody', 'PageTopBar', 'DataBodySummary', 'DataBodyTab', 'TableView', 'ChartView'],
      requiredBindings: [{ source: 'datasource', datasourceUid: 'metrics' }],
      requiredText: ['Service metrics', 'Metrics', 'Overview'],
      forbiddenKindPrefixes: ['DesignKit', 'GridKit', 'ChartKit', 'BaseKit'],
    },
  },
]
