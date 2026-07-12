import type { Resource } from '@loykin/resourcekit'

export const scenarioCustomerRows = [
  { id: '1', name: 'Ada Lovelace', status: 'active', revenue: 140 },
  { id: '2', name: 'Grace Hopper', status: 'prospect', revenue: 118 },
  { id: '3', name: 'Katherine Johnson', status: 'active', revenue: 168 },
]

export const scenarioMetricsRows = [
  { service: 'API', p95: 181, errors: 12, status: 'healthy' },
  { service: 'Billing', p95: 244, errors: 28, status: 'watch' },
  { service: 'Search', p95: 132, errors: 7, status: 'healthy' },
]

export const customerCrmScenario: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'ListDetail',
  metadata: { name: 'scenario-customer-crm' },
  spec: {
    listWidth: 340,
    selectionVariable: 'customerId',
    variables: [
      { name: 'customerId', type: 'string', default: '1', persist: 'url' },
      { name: 'status', type: 'string', default: 'active' },
    ],
  },
  slots: [
    {
      name: 'topBar',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'PageTopBar',
          spec: { left: 'Customers', height: '76px' },
          slots: [
            {
              name: 'right',
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'FilterControl',
                  spec: {
                    valueRef: 'variables.status',
                    config: {
                      key: 'status',
                      type: 'select',
                      label: 'Status',
                      options: [
                        { label: 'Active', value: 'active' },
                        { label: 'Prospect', value: 'prospect' },
                      ],
                      behavior: { clearable: true },
                    },
                    events: { change: { kind: 'setVariable', variable: 'status', from: 'value' } },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'list',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'SelectableList',
          spec: {
            data: { source: 'static', rows: scenarioCustomerRows },
            idField: 'id',
            selectedRef: 'variables.customerId',
            primary: { field: 'name' },
            secondary: [
              { field: 'status', label: 'Status' },
              { field: 'revenue', label: 'Revenue' },
            ],
            events: { select: { kind: 'setVariable', variable: 'customerId', from: 'row.id' } },
          },
        },
      ],
    },
    {
      name: 'detail',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'RecordScope',
          spec: {
            data: {
              source: 'datasource',
              datasourceUid: 'crm',
              query: { id: '${customerId}' },
            },
          },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DataBody',
                  spec: { title: 'Customer detail', description: 'Selected customer profile and revenue trend.' },
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'DataBodyGroup',
                          spec: { title: 'Profile', layout: 'inline', variant: 'plain' },
                          slots: [
                            {
                              items: [
                                {
                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                  kind: 'ObjectFields',
                                  spec: {
                                    fields: [
                                      { label: 'Name', path: 'name' },
                                      { label: 'Status', path: 'status', display: 'badge' },
                                      { label: 'Revenue', path: 'revenue' },
                                    ],
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'ChartView',
                          spec: {
                            chart: {
                              type: 'bar',
                              height: 220,
                              categories: scenarioCustomerRows.map((row) => row.name),
                              series: [{ label: 'Revenue', color: '#2563eb', values: scenarioCustomerRows.map((row) => row.revenue) }],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'emptyDetail',
      items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Panel', spec: { title: 'No customer selected' } }],
    },
  ],
}

export const settingsFormScenario: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'DataBody',
  metadata: { name: 'scenario-settings-form' },
  spec: { title: 'Workspace settings', description: 'Form-local state with declarative submit.' },
  slots: [
    {
      name: 'topBar',
      items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'PageTopBar', spec: { left: 'Settings / Workspace' } }],
    },
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ResourceForm',
          spec: {
            submitLabel: 'Save settings',
            successMessage: 'Settings saved',
            submit: { action: 'saveSettings', mutation: { target: 'memory', collection: 'settings' } },
          },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DataBodySection',
                  spec: { id: 'general', label: 'General', description: 'Workspace identity' },
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'DataBodyRow',
                          spec: { label: 'Name', required: true },
                          slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'InputControl', spec: { name: 'name', value: 'Acme Operations' } }] }],
                        },
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'DataBodyRow',
                          spec: { label: 'Slug' },
                          slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'InputControl', spec: { name: 'slug', value: 'acme-ops' } }] }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

export const metricsDashboardScenario: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'DataBody',
  metadata: { name: 'scenario-metrics-dashboard' },
  spec: { title: 'Service metrics', description: 'Scenario dashboard with summary, table, and chart.', defaultTab: 'overview' },
  slots: [
    {
      name: 'topBar',
      items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'PageTopBar', spec: { left: 'Metrics' } }],
    },
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DataBodySummary',
          spec: {},
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DataBodyGroup',
                  spec: { title: 'Current status', layout: 'inline', variant: 'plain' },
                  slots: [
                    {
                      items: [
                        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'DataBodyField', spec: { label: 'Services', value: '3' } },
                        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'DataBodyField', spec: { label: 'Errors', value: '47' } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DataBodyTab',
          spec: { id: 'overview', label: 'Overview', count: scenarioMetricsRows.length },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'TableView',
                  spec: {
                    data: { source: 'static', rows: scenarioMetricsRows },
                    columns: {
                      service: { label: 'Service', emphasis: 'strong' },
                      status: { label: 'Status', display: 'badge' },
                      p95: { label: 'P95', type: 'number', align: 'right' },
                      errors: { label: 'Errors', type: 'number', align: 'right' },
                    },
                    enableSorting: true,
                    pagination: { pageSize: 5 },
                  },
                },
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ChartView',
                  spec: {
                    chart: {
                      type: 'bar',
                      height: 220,
                      categories: scenarioMetricsRows.map((row) => row.service),
                      series: [{ label: 'P95 latency', color: '#7c3aed', values: scenarioMetricsRows.map((row) => row.p95) }],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

export const scenarioExamples = [
  {
    id: 'scenario-customer-crm',
    name: 'Scenario / Customer CRM',
    description: 'Scenario fixture: list/detail selection, filter variable, detail summary, and chart.',
    resource: customerCrmScenario,
  },
  {
    id: 'scenario-settings-form',
    name: 'Scenario / Settings form',
    description: 'Scenario fixture: data body sections with form-local state and declarative submit.',
    resource: settingsFormScenario,
  },
  {
    id: 'scenario-metrics-dashboard',
    name: 'Scenario / Metrics dashboard',
    description: 'Scenario fixture: tabbed metrics body with summary, table, and chart.',
    resource: metricsDashboardScenario,
  },
] as const
