import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  useStyleInjector,
} from '@loykin/designkit'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { Braces, LayoutDashboard, Route, Sparkles } from 'lucide-react'
import {
  createConnectionDataResolver,
  createRegistry,
  nextStage,
  nextStageBatch,
  restConnectionAdapter,
  restResolver,
  singleKindSchema,
  staticResolver,
  validateResource,
} from '@loykin/resourcekit'
import type { DataResolver, JsonSchema, Resource, MutationBinding, MutationResolver, ValidationResult } from '@loykin/resourcekit'
import { ResourceRenderer } from '@loykin/resourcekit/react'
import type { KindRenderFn } from '@loykin/resourcekit/react'
import { publicKindNames } from '@loykin/resourcekit/adapters'
import { createDatasourceKitConnectionAdapter } from '@loykin/resourcekit/adapters/datasourcekit'
import { createPlaygroundConnectionProvider, createPlaygroundDatasourceManager } from './demoDatasourceKit'
import { createPlaygroundResourceAdapters } from './resourceAdapters'
import { scenarioExamples } from './scenarios'

const customerRows = [
  { id: '1', name: 'Ada Lovelace', status: 'active', revenue: 140 },
  { id: '2', name: 'Grace Hopper', status: 'prospect', revenue: 118 },
  { id: '3', name: 'Katherine Johnson', status: 'active', revenue: 168 },
]

const userRows = [
  { name: 'Sarah Kim', email: 'sarah@acme.com', role: 'Admin', status: 'Active', joined: '2024-01-12' },
  { name: 'Marcus Lee', email: 'marcus@acme.com', role: 'Editor', status: 'Active', joined: '2024-02-03' },
  { name: 'Ji-Yeon Park', email: 'jiyeon@acme.com', role: 'Viewer', status: 'Inactive', joined: '2024-03-18' },
  { name: 'Alex Chen', email: 'alex@acme.com', role: 'Editor', status: 'Active', joined: '2024-04-07' },
  { name: 'Dana White', email: 'dana@acme.com', role: 'Viewer', status: 'Pending', joined: '2024-04-29' },
  { name: 'Leo Torres', email: 'leo@acme.com', role: 'Admin', status: 'Inactive', joined: '2024-05-01' },
  { name: 'Mina Seo', email: 'mina@acme.com', role: 'Editor', status: 'Active', joined: '2024-05-02' },
  { name: 'Ryan Patel', email: 'ryan@acme.com', role: 'Viewer', status: 'Active', joined: '2024-05-15' },
  { name: 'Yuna Choi', email: 'yuna@acme.com', role: 'Editor', status: 'Pending', joined: '2024-06-03' },
  { name: 'Tom Fischer', email: 'tom@acme.com', role: 'Viewer', status: 'Active', joined: '2024-06-20' },
]

const incidentRows = [
  { id: 'INC-1001', service: 'API', severity: 'high' },
  { id: 'INC-1002', service: 'Billing', severity: 'medium' },
  { id: 'INC-1003', service: 'Search', severity: 'low' },
]

const metricsRows = [
  { service: 'API', p95: 181, errors: 12, status: 'healthy' },
  { service: 'Billing', p95: 244, errors: 28, status: 'watch' },
  { service: 'Search', p95: 132, errors: 7, status: 'healthy' },
]

function jsonDataUrl(value: unknown): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify(value))}`
}

const playgroundDatasourceResolver: DataResolver = async (binding) => {
  if (binding.source !== 'datasource') return []
  const query = typeof binding.query === 'object' && binding.query !== null ? (binding.query as Record<string, unknown>) : {}
  if (binding.datasourceUid === 'crm') {
    const status = typeof query.status === 'string' ? query.status : undefined
    const id = typeof query.id === 'string' ? query.id : undefined
    return customerRows.filter((row) => (!status || row.status === status) && (!id || row.id === id))
  }
  if (binding.datasourceUid === 'metrics') {
    const service = typeof query.service === 'string' ? query.service : undefined
    return metricsRows.filter((row) => !service || row.service === service)
  }
  return []
}

// In-memory CRUD backend — stands in for a real REST API or datasource so the
// full read → edit → mutate → refetch loop can run inside the playground.
const memoryUsers: Record<string, unknown>[] = userRows.map((row, index) => ({ id: String(index + 1), ...row }))

const memoryDataResolver: DataResolver = async (rawBinding) => {
  const binding = rawBinding as Record<string, unknown>
  if (binding.collection !== 'users') return []
  const id = typeof binding.id === 'string' ? binding.id : undefined
  const rows = memoryUsers.map((row) => ({ ...row }))
  return id ? rows.filter((row) => row.id === id) : rows
}

const memoryMutationResolver: MutationResolver = async (rawBinding, payload) => {
  const binding = rawBinding as Record<string, unknown>
  if (binding.collection === 'settings') return { ...(typeof payload === 'object' && payload !== null ? payload : {}), version: String(Date.now()) }
  if (binding.collection !== 'users') throw new Error(`unknown collection: ${String(binding.collection)}`)
  const values = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  const id = typeof binding.id === 'string' ? binding.id : undefined
  if (id) {
    const row = memoryUsers.find((item) => item.id === id)
    if (!row) throw new Error(`user ${id} not found`)
    Object.assign(row, values)
    return { ...row, version: String(Date.now()) }
  }
  const row = { id: String(memoryUsers.length + 1), status: 'Pending', joined: new Date().toISOString().slice(0, 10), ...values }
  memoryUsers.push(row)
  return { ...row, version: String(Date.now()) }
}

// Same mutation mechanism examples/mcp-server uses (MutationBinding, not
// ConnectionAdapter — writes stay on the existing SubmitSpec path; test.md
// never gave ConnectionAdapter a mutate method, see §9's admin-vs-generation
// MCP split). Proves a connection-bound *read* (DetailView) and a
// mutation-bound *write* (FormView) against the same backend actually
// round-trip together.
const restMutationResolver: MutationResolver = async (rawBinding, payload) => {
  const binding = rawBinding as Extract<MutationBinding, { target: 'rest' }>
  const response = await fetch(binding.url, {
    method: binding.method ?? 'PATCH',
    headers: { 'content-type': 'application/json', ...binding.headers },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`REST mutation failed: ${response.status} ${response.statusText}`)
  return response.json()
}

const customerWorkspace: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'ListDetail',
  metadata: { name: 'customers' },
  spec: {
    listWidth: 360,
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
                    events: {
                      change: { kind: 'setVariable', variable: 'status', from: 'value' },
                    },
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
            data: {
              source: 'static',
              rows: customerRows,
            },
            idField: 'id',
            selectedRef: 'variables.customerId',
            primary: { field: 'name' },
            secondary: [
              { field: 'status', label: 'Status' },
              { field: 'revenue', label: 'Revenue' },
            ],
            events: {
              select: { kind: 'setVariable', variable: 'customerId', from: 'row.id' },
            },
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
                  spec: {
                    title: 'Customer profile',
                    description: 'Selected record rendered through a scoped detail view.',
                  },
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'DataBodyGroup',
                          spec: { title: 'Overview', layout: 'inline', variant: 'plain' },
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
                              categories: ['Jan', 'Feb', 'Mar'],
                              series: [
                                { label: 'Revenue', color: '#2563eb', values: [100, 140, 118] },
                                { label: 'Costs', color: '#f97316', values: [60, 70, 68] },
                              ],
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
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'No customer selected' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'Text',
                  spec: { text: 'Select a row to inspect the renderer variable binding path.' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

// Built by a blind subagent test of examples/mcp-server: zero prior knowledge
// of resourcekit's schema, only MCP tool calls + their JSON responses.
// Validated on the first attempt. See the session for the full transcript.
const trendingReposPage: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'DataBody',
  metadata: { name: 'trending-repos-page' },
  spec: {
    title: "This Week's Top Trending Repositories",
    description: 'The top 5 trending GitHub repositories this week, by star count.',
  },
  slots: [
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'TableView',
          spec: {
            title: 'Top 5 Trending Repositories',
            data: {
              source: 'static',
              rows: [
                { name: 'torvalds/linux', language: 'C', stars: 178000 },
                { name: 'facebook/react', language: 'JavaScript', stars: 231000 },
                { name: 'microsoft/vscode', language: 'TypeScript', stars: 168000 },
                { name: 'vercel/next.js', language: 'JavaScript', stars: 128000 },
                { name: 'ollama/ollama', language: 'Go', stars: 100000 },
              ],
            },
            columns: {
              name: { label: 'Repository', type: 'text' },
              language: { label: 'Language', type: 'text' },
              stars: { label: 'Stars', type: 'number', align: 'right' },
            },
          },
        },
      ],
    },
  ],
}

const metricsChart: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'Panel',
  metadata: { name: 'monthly-revenue' },
  spec: { title: 'Monthly revenue', eyebrow: 'ChartKit example' },
  slots: [
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Text',
          spec: { text: 'A smaller resource document that renders one chart leaf.' },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ChartView',
          spec: {
            chart: {
              type: 'bar',
              height: 260,
              categories: ['Q1', 'Q2', 'Q3', 'Q4'],
              series: [
                { label: 'Revenue', color: '#2563eb', values: [120, 180, 160, 220] },
                { label: 'Pipeline', color: '#14b8a6', values: [90, 130, 170, 190] },
              ],
            },
          },
        },
      ],
    },
  ],
}

const chartGallery: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'Workbench',
  metadata: { name: 'chart-gallery' },
  spec: { leftWidth: 360, rightWidth: 360 },
  slots: [
    {
      name: 'topBar',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Chart gallery', eyebrow: 'ChartKit specs rendered from JSON' },
        },
      ],
    },
    {
      name: 'leftPane',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Donut' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ChartView',
                  spec: {
                    chart: {
                      type: 'pie',
                      height: 260,
                      innerRadius: 0.62,
                      centerLabel: '100\nTotal',
                      labelType: 'name+percent',
                      labelPosition: 'outside',
                      legendPosition: 'bottom',
                      slices: [
                        { label: 'Enterprise', value: 42, color: '#2563eb' },
                        { label: 'Growth', value: 31, color: '#14b8a6' },
                        { label: 'Starter', value: 27, color: '#f97316' },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'mainPane',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Time series' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ChartView',
                  spec: {
                    chart: {
                      type: 'timeseries',
                      height: 280,
                      yUnit: 'k$',
                      legendPosition: 'bottom',
                      data: [
                        [1717200000, 1717286400, 1717372800, 1717459200, 1717545600, 1717632000],
                        [82, 91, 88, 105, 112, 126],
                        [43, 48, 46, 57, 61, 66],
                      ],
                      series: [
                        { label: 'Revenue', color: '#2563eb', type: 'area', unit: 'k$' },
                        { label: 'Cost', color: '#f97316', type: 'line', unit: 'k$' },
                      ],
                      thresholds: [{ value: 100, color: '#16a34a', label: 'Target', dash: [4, 2] }],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'rightPane',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Stat' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ChartView',
                  spec: {
                    chart: {
                      type: 'stat',
                      height: 140,
                      value: 94.2,
                      previousValue: 88.6,
                      label: 'Activation',
                      unit: '%',
                      sparkline: [73, 76, 79, 81, 86, 88, 94],
                      thresholds: [
                        { value: 0, color: '#ef4444' },
                        { value: 80, color: '#f59e0b' },
                        { value: 90, color: '#16a34a' },
                      ],
                    },
                  },
                },
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ChartView',
                  spec: {
                    chart: {
                      type: 'gauge',
                      height: 210,
                      value: 67,
                      min: 0,
                      max: 100,
                      unit: '%',
                      label: 'Capacity',
                      thresholds: [
                        { value: 0, color: '#16a34a' },
                        { value: 60, color: '#f59e0b' },
                        { value: 80, color: '#ef4444' },
                      ],
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

const workbenchTemplate: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'Workbench',
  metadata: { name: 'operations-workbench' },
  spec: { leftWidth: 320, rightWidth: 340 },
  slots: [
    {
      name: 'topBar',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Operations workbench', eyebrow: 'Workbench' },
        },
      ],
    },
    {
      name: 'leftPane',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DataBody',
          spec: { title: 'Queue', description: 'Compact side content.' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DataBodyGroup',
                  spec: { title: 'Counts', variant: 'bordered' },
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'DataBodyField',
                          spec: { label: 'Open', value: '24' },
                        },
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'DataBodyField',
                          spec: { label: 'Blocked', value: '3' },
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
      name: 'mainPane',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'TableView',
          spec: {
            title: 'Tasks',
            enableSorting: true,
            data: {
              source: 'static',
              rows: [
                { id: 'T-101', owner: 'Ada', priority: 'P1', state: 'open' },
                { id: 'T-102', owner: 'Grace', priority: 'P2', state: 'blocked' },
                { id: 'T-103', owner: 'Katherine', priority: 'P1', state: 'open' },
              ],
            },
          },
        },
      ],
    },
    {
      name: 'rightPane',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Throughput' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ChartView',
                  spec: {
                    chart: {
                      type: 'bar',
                      height: 240,
                      categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
                      series: [{ label: 'Done', color: '#2563eb', values: [8, 12, 11, 15, 18] }],
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

const fromValueBinding: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'Panel',
  metadata: { name: 'from-value-binding' },
  spec: {
    title: 'from: value binding',
    eyebrow: 'Button event writes a variable',
    variables: [{ name: 'selectedPlan', type: 'string', default: 'starter' }],
  },
  slots: [
    {
      name: 'actions',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ActionButton',
          spec: {
            label: 'Set Growth',
            value: 'growth',
            size: 'sm',
            events: {
              click: { kind: 'setVariable', variable: 'selectedPlan', from: 'value' },
            },
          },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ActionButton',
          spec: {
            label: 'Set Enterprise',
            value: 'enterprise',
            size: 'sm',
            variant: 'outline',
            events: {
              click: { kind: 'setVariable', variable: 'selectedPlan', from: 'value' },
            },
          },
        },
      ],
    },
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DataBody',
          spec: { title: 'Runtime variable' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DataBodyGroup',
                  spec: { title: 'Selected plan', layout: 'inline', variant: 'bordered' },
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'DataBodyField',
                          spec: {
                            label: 'variables.selectedPlan',
                            valueRef: 'variables.selectedPlan',
                            description: 'Updated by click payload path from: "value".',
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
  ],
}

const fromRowBinding: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'Workbench',
  metadata: { name: 'from-row-binding' },
  spec: {
    rightPaneWidth: 320,
    variables: [{ name: 'ticketId', type: 'string', default: 'INC-1001' }],
  },
  slots: [
    {
      name: 'mainPane',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'TableView',
          spec: {
            title: 'Incidents',
            data: {
              source: 'static',
              rows: incidentRows,
            },
            events: {
              rowSelect: { kind: 'setVariable', variable: 'ticketId', from: 'row.id' },
            },
          },
        },
      ],
    },
    {
      name: 'rightPane',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Selected incident', eyebrow: 'from: row.id' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DataBodyField',
                  spec: {
                    label: 'variables.ticketId',
                    valueRef: 'variables.ticketId',
                    description: 'Updated by TableView rowSelect payload path from: "row.id".',
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

const restDataTable: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'DataBody',
  metadata: { name: 'rest-data-table' },
  spec: { title: 'Users', description: 'Rows resolved through source: "rest" and rowsPath.' },
  slots: [
    {
      name: 'actions',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ActionButton',
          spec: { label: 'Export', size: 'sm', variant: 'outline' },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ActionButton',
          spec: { label: 'Add User', size: 'sm' },
        },
      ],
    },
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'TableView',
          spec: {
            title: 'Users from REST',
            enableSorting: true,
            globalSearch: true,
            searchPlaceholder: 'Search users...',
            searchableColumns: ['name', 'email', 'role', 'status'],
            tableHeight: 420,
            pagination: { pageSize: 10 },
            columns: {
              name: { label: 'Name', flex: 1.25, emphasis: 'strong' },
              email: { label: 'Email', flex: 1.5, tone: 'muted' },
              role: { label: 'Role', flex: 0.85, display: 'badge', variant: 'outline' },
              status: {
                label: 'Status',
                flex: 0.85,
                display: 'badge',
                map: { Active: 'default', Pending: 'secondary', Inactive: 'outline' },
              },
              joined: { label: 'Joined', type: 'date', flex: 1, tone: 'muted' },
            },
            data: {
              source: 'rest',
              url: jsonDataUrl({ data: { items: userRows } }),
              rowsPath: 'data.items',
            },
          },
        },
      ],
    },
  ],
}

const datasourceDataTable: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'DataBody',
  metadata: { name: 'datasource-data-table' },
  spec: {
    title: 'CRM Customers',
    description: 'Rows resolved through source: "datasource" as a datasourcekit adapter would register it.',
    variables: [
      { name: 'customerId', type: 'string', default: '1' },
      { name: 'status', type: 'string', default: 'active' },
    ],
  },
  slots: [
    {
      name: 'actions',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ActionButton',
          spec: { label: 'Sync', size: 'sm', variant: 'outline' },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ActionButton',
          spec: { label: 'Add Customer', size: 'sm' },
        },
      ],
    },
    {
      name: 'toolbarLeft',
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
            },
            events: {
              change: { kind: 'setVariable', variable: 'status', from: 'value' },
            },
          },
        },
      ],
    },
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'TableView',
          spec: {
            title: 'CRM customers',
            enableSorting: true,
            globalSearch: true,
            searchPlaceholder: 'Search customers...',
            searchableColumns: ['name', 'status', 'revenue'],
            tableHeight: 420,
            pagination: { pageSize: 10 },
            columns: {
              id: { label: 'ID', flex: 0.6, tone: 'muted' },
              name: { label: 'Name', flex: 1.5, emphasis: 'strong' },
              status: {
                label: 'Status',
                flex: 1,
                display: 'badge',
                map: { active: 'default', prospect: 'secondary' },
              },
              revenue: { label: 'Revenue', type: 'number', align: 'right', flex: 1 },
            },
            data: {
              source: 'datasource',
              datasourceUid: 'crm',
              datasourceType: 'demo-crm',
              query: {
                table: 'customers',
                status: '${status}',
              },
            },
          },
        },
      ],
    },
  ],
}

const userManagement: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'DataBody',
  metadata: { name: 'user-management' },
  spec: {
    title: 'Team members',
    description: 'Invite, edit, and manage workspace access.',
    variables: [
      { name: 'usersVersion', type: 'string', default: '0' },
      { name: 'createOpen', type: 'string' },
    ],
  },
  slots: [
    {
      name: 'actions',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'ActionButton',
          spec: {
            label: 'Add member',
            size: 'sm',
            value: '1',
            events: {
              click: { kind: 'setVariable', variable: 'createOpen', from: 'value' },
            },
          },
        },
      ],
    },
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'TableView',
          spec: {
            enableSorting: true,
            globalSearch: true,
            searchPlaceholder: 'Search members...',
            searchableColumns: ['name', 'email', 'role', 'status'],
            tableHeight: 480,
            pagination: { pageSize: 10 },
            data: { source: 'memory', collection: 'users', v: '${usersVersion}' },
            columns: {
              id: { label: 'ID', flex: 0.4, tone: 'muted' },
              name: { label: 'Name', flex: 1.2, emphasis: 'strong' },
              email: { label: 'Email', flex: 1.4, tone: 'muted' },
              role: { label: 'Role', flex: 0.8, display: 'badge', variant: 'outline' },
              status: {
                label: 'Status',
                flex: 0.8,
                display: 'badge',
                map: { Active: 'default', Pending: 'secondary', Inactive: 'outline' },
              },
              joined: { label: 'Joined', type: 'date', flex: 0.9, tone: 'muted' },
            },
          },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Sheet',
          spec: { openVariable: 'createOpen', title: 'Add member', width: 440 },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ResourceForm',
                  spec: {
                    submit: {
                      action: 'users.create',
                      mutation: { target: 'memory', collection: 'users' },
                      onSuccess: [
                        { kind: 'setVariable', variable: 'usersVersion', from: 'version' },
                        { kind: 'setVariable', variable: 'createOpen' },
                        { kind: 'emit', event: 'users.created' },
                      ],
                    },
                    submitLabel: 'Create member',
                  },
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'DataBodyGroup',
                          spec: {
                            title: 'Profile',
                            description: 'The member receives an invite email.',
                            layout: 'stacked',
                            variant: 'plain',
                          },
                          slots: [
                            {
                              items: [
                                {
                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                  kind: 'DataBodyRow',
                                  spec: { label: 'Name', required: true },
                                  slots: [
                                    {
                                      items: [
                                        {
                                          apiVersion: 'resourcekit.dev/v1alpha1',
                                          kind: 'InputControl',
                                          spec: { name: 'name', placeholder: 'Full name' },
                                        },
                                      ],
                                    },
                                  ],
                                },
                                {
                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                  kind: 'DataBodyRow',
                                  spec: { label: 'Email', required: true },
                                  slots: [
                                    {
                                      items: [
                                        {
                                          apiVersion: 'resourcekit.dev/v1alpha1',
                                          kind: 'InputControl',
                                          spec: { name: 'email', type: 'email', placeholder: 'name@acme.com' },
                                        },
                                      ],
                                    },
                                  ],
                                },
                                {
                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                  kind: 'DataBodyRow',
                                  spec: { label: 'Role' },
                                  slots: [
                                    {
                                      items: [
                                        {
                                          apiVersion: 'resourcekit.dev/v1alpha1',
                                          kind: 'InputControl',
                                          spec: { name: 'role', placeholder: 'Admin / Editor / Viewer' },
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
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

const userEditor: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'ListDetail',
  metadata: { name: 'user-editor' },
  spec: {
    listWidth: 380,
    selectionVariable: 'userId',
    variables: [
      { name: 'userId', type: 'string', default: '1' },
      { name: 'usersVersion', type: 'string', default: '0' },
    ],
  },
  slots: [
    {
      name: 'list',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'SelectableList',
          spec: {
            data: { source: 'memory', collection: 'users', v: '${usersVersion}' },
            idField: 'id',
            selectedRef: 'variables.userId',
            primary: { field: 'name' },
            secondary: [
              { field: 'email' },
              { field: 'role', label: 'Role' },
              { field: 'status', label: 'Status' },
            ],
            events: {
              select: { kind: 'setVariable', variable: 'userId', from: 'row.id' },
            },
          },
        },
      ],
    },
    {
      name: 'detail',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Edit user', eyebrow: 'record scope → form → mutation → refetch' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'RecordScope',
                  spec: {
                    data: { source: 'memory', collection: 'users', id: '${userId}', v: '${usersVersion}' },
                  },
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'ResourceForm',
                          spec: {
                            submit: {
                              action: 'users.update',
                              mutation: { target: 'memory', collection: 'users', id: '${userId}' },
                              onSuccess: [{ kind: 'setVariable', variable: 'usersVersion', from: 'version' }],
                            },
                            submitLabel: 'Save changes',
                            successMessage: 'User updated — list refreshed.',
                          },
                          slots: [
                            {
                              items: [
                                {
                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                  kind: 'DataBodyGroup',
                                  spec: { title: 'Profile', layout: 'stacked', variant: 'plain' },
                                  slots: [
                                    {
                                      items: [
                                        {
                                          apiVersion: 'resourcekit.dev/v1alpha1',
                                          kind: 'DataBodyRow',
                                          spec: { label: 'Name', required: true },
                                          slots: [
                                            {
                                              items: [
                                                {
                                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                                  kind: 'InputControl',
                                                  spec: { name: 'name', fieldRef: 'name', placeholder: 'Full name' },
                                                },
                                              ],
                                            },
                                          ],
                                        },
                                        {
                                          apiVersion: 'resourcekit.dev/v1alpha1',
                                          kind: 'DataBodyRow',
                                          spec: { label: 'Email', required: true },
                                          slots: [
                                            {
                                              items: [
                                                {
                                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                                  kind: 'InputControl',
                                                  spec: { name: 'email', type: 'email', fieldRef: 'email', placeholder: 'user@acme.com' },
                                                },
                                              ],
                                            },
                                          ],
                                        },
                                        {
                                          apiVersion: 'resourcekit.dev/v1alpha1',
                                          kind: 'DataBodyRow',
                                          spec: { label: 'Role' },
                                          slots: [
                                            {
                                              items: [
                                                {
                                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                                  kind: 'InputControl',
                                                  spec: { name: 'role', fieldRef: 'role', placeholder: 'Admin / Editor / Viewer' },
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
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'No user selected' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'Text',
                  spec: { text: 'Select a row to load the record into the form.' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

// Built via real MCP tool calls against examples/mcp-server's connection
// tools (list_connections → test_connection → preview_connection →
// list_root_templates → next_stage_batch → validate_document), driven by an
// actual MCP client (SDK Client + stdio transport), not hand-written. Its
// `data` bindings reference the "demo-users" connection registered above by
// uid — the same ConnectionAdapter contract examples/mcp-server uses, just
// against this playground's own same-origin demo API instead of a separate
// process.
const demoUsersConnectionPage: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'ListDetail',
  metadata: { name: 'demo-users-page' },
  spec: {
    listWidth: 320,
    selectionVariable: 'userId',
    variables: [{ name: 'userId', type: 'string', default: '1', persist: 'url' }],
  },
  slots: [
    {
      name: 'topBar',
      items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'PageTopBar', spec: { left: 'Users' } }],
    },
    {
      name: 'list',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'SelectableList',
          spec: {
            data: { source: 'connection', connection: 'demo-users', request: { path: '/users' } },
            idField: 'id',
            selectedRef: 'variables.userId',
            primary: { field: 'name' },
            secondary: [{ field: 'role', label: 'Role' }],
            events: { select: { kind: 'setVariable', variable: 'userId', from: 'row.id' } },
          },
        },
      ],
    },
    {
      name: 'detail',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DetailView',
          spec: {
            data: { source: 'connection', connection: 'demo-users', request: { path: '/users/${userId}' } },
            fields: [
              { field: 'name', label: 'Name' },
              { field: 'email', label: 'Email' },
              { field: 'role', label: 'Role', display: 'badge' },
            ],
          },
        },
      ],
    },
  ],
}

// Top 10 crypto by market cap via the real CoinGecko API — a genuinely
// unfamiliar third-party connection, not one of our own demo backends.
const coinMarketCapTop10: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'SelectableList',
  metadata: { name: 'coin-market-cap-top10' },
  spec: {
    data: {
      source: 'connection',
      connection: 'coingecko',
      request: { path: '/coins/markets', query: { vs_currency: 'usd', order: 'market_cap_desc', per_page: '10', page: '1' } },
    },
    idField: 'id',
    primary: { field: 'name' },
    secondary: [
      { field: 'current_price', label: 'Price (USD)' },
      { field: 'market_cap_rank', label: 'Rank' },
    ],
  },
}

// Connection-bound read (DetailView) next to a mutation-bound write
// (FormView, target: 'rest' PATCH) against the *same* demo-users backend —
// proves a write actually persists and the connection-bound read reflects
// it (after a refetch; writes don't auto-invalidate reads with no shared
// variable, see connectionWriteReadPage's own note below).
const connectionWriteReadPage: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'DataBody',
  metadata: { name: 'connection-write-read' },
  spec: { title: 'Write path check', description: 'Edit the role below, save, then reload this page — the read above should show the new value.' },
  slots: [
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DetailView',
          spec: {
            data: { source: 'connection', connection: 'demo-users', request: { path: '/users/2' } },
            fields: [
              { field: 'name', label: 'Name' },
              { field: 'role', label: 'Role (read via connection)', display: 'badge' },
            ],
          },
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'FormView',
          spec: {
            submitLabel: 'Save role',
            successMessage: 'Saved — reload the page to see the connection-bound read pick it up',
            submit: { mutation: { target: 'rest', url: `${window.location.origin}/api/demo-users/users/2`, method: 'PATCH' } },
            sections: [{ id: 'role', fields: [{ name: 'role', label: 'New role for Bob Martinez', required: true }] }],
          },
        },
      ],
    },
  ],
}

const dynamicDatasourceKitPage: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'DataBody',
  metadata: { name: 'dynamic-datasourcekit-metrics' },
  spec: {
    title: 'Dynamic DatasourceKit metrics',
    description: 'Runs entirely in the browser: ConnectionProvider lookup → DatasourceKit connection adapter → in-memory backend.',
  },
  slots: [
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'TableView',
          spec: {
            title: 'Host CPU',
            columns: {
              host: { label: 'Host', emphasis: 'strong' },
              region: { label: 'Region' },
              cpuPercent: { label: 'CPU %', type: 'number', align: 'right' },
            },
            data: {
              source: 'connection',
              connection: 'demo-metrics-dynamic',
              request: { metric: 'cpuPercent' },
            },
          },
        },
      ],
    },
  ],
}

// Built via a live MCP client session against examples/mcp-server's
// "github" connection (test_connection → preview_connection ×2 →
// next_stage_batch → get_kind_spec_schema → validate_document) — not
// hand-written. `variables.repoFullName.default` is whatever repo the
// GitHub API returned as most-recently-updated at build time; it may not
// be "the" most recent by the time this renders, but it's a real repo.
const githubOrgReposPage: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'ListDetail',
  metadata: { name: 'github-org-repos' },
  spec: {
    listWidth: 320,
    selectionVariable: 'repoFullName',
    variables: [{ name: 'repoFullName', type: 'string', default: 'vercel/eve', persist: 'url' }],
  },
  slots: [
    {
      name: 'topBar',
      items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'PageTopBar', spec: { left: 'vercel repos' } }],
    },
    {
      name: 'list',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'SelectableList',
          spec: {
            data: { source: 'connection', connection: 'github', request: { path: '/orgs/vercel/repos', query: { per_page: '10', sort: 'updated' } } },
            idField: 'full_name',
            selectedRef: 'variables.repoFullName',
            primary: { field: 'name' },
            secondary: [
              { field: 'stargazers_count', label: 'Stars' },
              { field: 'language', label: 'Language' },
            ],
            events: { select: { kind: 'setVariable', variable: 'repoFullName', from: 'row.full_name' } },
          },
        },
      ],
    },
    {
      name: 'detail',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DetailView',
          spec: {
            data: { source: 'connection', connection: 'github', request: { path: '/repos/${repoFullName}' } },
            fields: [
              { field: 'description', label: 'Description' },
              { field: 'stargazers_count', label: 'Stars' },
              { field: 'language', label: 'Language', display: 'badge' },
              { field: 'open_issues_count', label: 'Open issues' },
            ],
          },
        },
      ],
    },
  ],
}

const examples = [
  ...scenarioExamples,
  {
    id: 'demo-users-connection-page',
    name: '[MCP-built] Demo users list/detail',
    description:
      'MCP-built: assembled from real list_connections/test_connection/preview_connection/next_stage_batch/get_kind_spec_schema calls against a live MCP server, then confirmed with validate_document.',
    resource: demoUsersConnectionPage,
  },
  {
    id: 'coin-market-cap-top10',
    name: '[hand-written] Top 10 by market cap',
    description:
      'Hand-written, not built through MCP tool calls — only proves the connection/rendering path works against a real, unfamiliar third-party API (CoinGecko), not the MCP generation flow.',
    resource: coinMarketCapTop10,
  },
  {
    id: 'github-org-repos',
    name: '[MCP-built] GitHub org repos',
    description:
      'MCP-built: assembled from real test_connection/preview_connection/next_stage_batch/get_kind_spec_schema calls against a live MCP server and a real GitHub connection, then confirmed with validate_document.',
    resource: githubOrgReposPage,
  },
  {
    id: 'connection-write-read',
    name: '[hand-written] Connection read + REST write',
    description:
      'Hand-written, not built through MCP tool calls — pairs a connection-bound read (DetailView) with a mutation-bound write (FormView) against the same backend to prove writes persist and reads reflect them.',
    resource: connectionWriteReadPage,
  },
  {
    id: 'dynamic-datasourcekit-metrics',
    name: 'Dynamic DatasourceKit metrics',
    description: 'Static-hosting-safe demo of a provider-backed DatasourceKit connection running entirely in the browser.',
    resource: dynamicDatasourceKitPage,
  },
  {
    id: 'user-editor',
    name: 'User editor (CRUD)',
    description: 'Row select → record fetch → form prefill → mutation → list refetch.',
    resource: userEditor,
  },
  {
    id: 'customer-workspace',
    name: 'Customer workspace',
    description: 'List/detail layout with a filter, table, detail panel, and chart.',
    resource: customerWorkspace,
  },
  {
    id: 'trending-repos-page',
    name: 'Trending repos (MCP blind test)',
    description: 'Built by a subagent with zero prior schema knowledge, via examples/mcp-server tool calls only.',
    resource: trendingReposPage,
  },
  {
    id: 'metrics-chart',
    name: 'Metrics chart',
    description: 'A compact panel document with one chart leaf.',
    resource: metricsChart,
  },
  {
    id: 'chart-gallery',
    name: 'Chart gallery',
    description: 'Multiple ChartKit specs rendered from JSON in a Workbench layout.',
    resource: chartGallery,
  },
  {
    id: 'workbench-template',
    name: 'Workbench template',
    description: 'Workbench with side panes, table content, and a chart.',
    resource: workbenchTemplate,
  },
  {
    id: 'from-value-binding',
    name: 'from: value binding',
    description: 'Button click payload writes variables.selectedPlan using from: "value".',
    resource: fromValueBinding,
  },
  {
    id: 'from-row-binding',
    name: 'from: row.id binding',
    description: 'Grid row selection writes variables.ticketId using from: "row.id".',
    resource: fromRowBinding,
  },
  {
    id: 'rest-data-table',
    name: 'REST data table',
    description: 'Grid rows resolved through source: "rest" and rowsPath.',
    resource: restDataTable,
  },
  {
    id: 'datasource-data-table',
    name: 'Datasource data table',
    description: 'Grid rows resolved through source: "datasource" as a datasourcekit adapter would register it.',
    resource: datasourceDataTable,
  },
  {
    id: 'user-management',
    name: 'User management',
    description: 'Full page: table + Add member sheet + create mutation + toast via onEvent.',
    resource: userManagement,
  },
] as const

const registry = createRegistry<KindRenderFn>()
const playgroundDatasourceManager = createPlaygroundDatasourceManager()
registry.use({
  name: 'playground-resolvers',
  dataResolvers: {
    datasource: playgroundDatasourceResolver,
    rest: restResolver,
    static: staticResolver,
    memory: memoryDataResolver,
    connection: createConnectionDataResolver(registry),
  },
  mutationResolvers: { memory: memoryMutationResolver, rest: restMutationResolver },
  connectionAdapters: { rest: restConnectionAdapter, datasourcekit: createDatasourceKitConnectionAdapter(playgroundDatasourceManager) },
})
registry.use(createPlaygroundResourceAdapters())
registry.setConnectionProvider(createPlaygroundConnectionProvider())

// Same "demo-users" connection as examples/mcp-server, but backed by
// vite.config.ts's demoUsersApiPlugin middleware (same origin, no separate
// process/CORS needed) instead of a standalone http.Server — proves a
// document built through the MCP server's connection tools renders here too,
// since it's the exact same ConnectionAdapter contract either way.
registry.registerConnection({
  uid: 'demo-users',
  type: 'rest',
  name: 'Demo Users API',
  description: 'In-memory demo REST API — GET /users, GET /users/:id, PATCH /users/:id.',
  config: { baseUrl: `${window.location.origin}/api/demo-users` },
  policy: { methods: ['GET', 'PATCH'], pathPrefixes: ['/users'] },
  mcpPolicy: { test: true, preview: true, mutate: false, maxRows: 20 },
})

// A real, unfamiliar third-party API (not one of ours) — proves the
// connection model isn't specific to our own demo backends. Public, no key,
// CORS-enabled for GET.
registry.registerConnection({
  uid: 'coingecko',
  type: 'rest',
  name: 'CoinGecko Markets API',
  description: 'Public crypto market data — GET /coins/markets.',
  config: { baseUrl: 'https://api.coingecko.com/api/v3' },
  policy: { methods: ['GET'], pathPrefixes: ['/coins'] },
  mcpPolicy: { test: true, preview: true, mutate: false, maxRows: 10 },
})

// Same connection uid/config as examples/mcp-server — the document below was
// built there via a live MCP client tool-calling session (list_connections →
// test_connection → preview_connection ×2 → list_root_templates →
// next_stage_batch → get_kind_spec_schema → validate_document), not
// hand-written, then copied here to render with the same live data.
registry.registerConnection({
  uid: 'github',
  type: 'rest',
  name: 'GitHub API',
  description: 'Public GitHub REST API (read-only here) — GET /orgs/:org/repos, GET /repos/:owner/:repo.',
  config: { baseUrl: 'https://api.github.com', headers: { accept: 'application/vnd.github+json' } },
  policy: { methods: ['GET'], pathPrefixes: ['/orgs', '/repos'] },
  mcpPolicy: { test: true, preview: true, mutate: false, maxRows: 10 },
})

const playgroundScope = registry.scope({
  apiVersions: ['resourcekit.dev/v1alpha1'],
  kinds: {
    include: publicKindNames(registry),
  },
  maxDepth: 8,
})

// ─── Step-by-step generation demo ──────────────────────────────────────────
// Demonstrates nextStage/nextStageBatch directly, with no pre-built loop —
// every step is a human click. This mirrors how an MCP client (already an
// agent) consumes these primitives itself: see
// docs/staged-generation-experiment.md "Final decision" for why resourcekit
// doesn't ship an orchestration loop of its own. Same registry as the
// runtime examples above, just scoped to root-eligible templates.
const stepScope = registry.scope({
  apiVersions: ['resourcekit.dev/v1alpha1'],
  kinds: { include: publicKindNames(registry) },
  rootLevels: ['template'],
  maxDepth: 8,
})

interface StepWorkingNode {
  apiVersion: string
  kind: string
  spec: unknown
  slots: { name?: string; items: StepWorkingNode[] }[]
}

interface StepCandidate {
  apiVersion: string
  kind: string
  description?: string
}

function stepResolveRef(schema: JsonSchema, defs: Record<string, JsonSchema>): JsonSchema {
  if (typeof schema.$ref === 'string') return defs[schema.$ref.replace('#/$defs/', '')] ?? {}
  return schema
}

function stepSlotOneOf(propSchema: JsonSchema): JsonSchema[] {
  const raw = propSchema.type === 'array' ? (propSchema.items as JsonSchema | undefined)?.oneOf : propSchema.oneOf
  return (raw ?? []) as JsonSchema[]
}

function stepCandidatesFromOneOf(oneOf: JsonSchema[], defs: Record<string, JsonSchema>): StepCandidate[] {
  return oneOf.map((branch) => {
    const resolved = stepResolveRef(branch, defs)
    const properties = (resolved.properties ?? {}) as Record<string, JsonSchema>
    return {
      apiVersion: (properties.apiVersion as JsonSchema | undefined)?.const as string,
      kind: (properties.kind as JsonSchema | undefined)?.const as string,
      description: resolved.description as string | undefined,
    }
  })
}

/** Generic schema-driven placeholder filler — spec content isn't the point of this demo, structural navigation is. */
function stepFillSpec(schema: JsonSchema, defs: Record<string, JsonSchema>, keyHint = 'value'): unknown {
  const resolved = stepResolveRef(schema, defs)
  if (resolved.const !== undefined) return resolved.const
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return resolved.enum[0]
  if (Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) return stepFillSpec(resolved.oneOf[0] as JsonSchema, defs, keyHint)
  if (resolved.type === 'object') {
    const properties = (resolved.properties ?? {}) as Record<string, JsonSchema>
    const required = Array.isArray(resolved.required) ? (resolved.required as string[]) : []
    const value: Record<string, unknown> = {}
    for (const key of required) if (properties[key]) value[key] = stepFillSpec(properties[key], defs, key)
    return value
  }
  if (resolved.type === 'array') {
    const minItems = typeof resolved.minItems === 'number' ? resolved.minItems : 0
    const itemsSchema = (resolved.items ?? {}) as JsonSchema
    return Array.from({ length: minItems }, () => stepFillSpec(itemsSchema, defs, keyHint))
  }
  if (resolved.type === 'boolean') return true
  if (resolved.type === 'number' || resolved.type === 'integer') return 0
  if (resolved.type === 'string') return `${keyHint} (placeholder)`
  return {}
}

function stepFillNodeSpec(apiVersion: string, kind: string): unknown {
  const schema = singleKindSchema(stepScope, apiVersion, kind)
  if (!schema) return {}
  const defs = (schema.$defs ?? {}) as Record<string, JsonSchema>
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
  return properties.spec ? stepFillSpec(properties.spec as JsonSchema, defs, 'value') : {}
}

function stepAddChild(node: StepWorkingNode, slotKey: string, child: StepWorkingNode): void {
  const realName = slotKey === '(default)' ? undefined : slotKey
  let entry = node.slots.find((s) => s.name === realName)
  if (!entry) {
    entry = { name: realName, items: [] }
    node.slots.push(entry)
  }
  entry.items.push(child)
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/**
 * Resolves every open slot on `node` by calling `nextStageBatch` and picking
 * a random valid candidate at each wave, recursing into what it added —
 * exactly the loop an automated MCP client would run itself, just with a
 * random pick instead of a model call. `budget` caps total nodes added so a
 * chain of repeatable slots can't produce an unbounded tree.
 */
function autoResolveNode(node: StepWorkingNode, logs: string[], budget: { remaining: number }): void {
  if (budget.remaining <= 0) return
  const batch = nextStageBatch(stepScope, { parent: { apiVersion: node.apiVersion, kind: node.kind } })

  for (const [slotKey, k] of Object.entries(batch.fixed)) {
    if (budget.remaining <= 0) break
    const child: StepWorkingNode = { apiVersion: k.apiVersion, kind: k.kind, spec: stepFillNodeSpec(k.apiVersion, k.kind), slots: [] }
    stepAddChild(node, slotKey, child)
    budget.remaining -= 1
    logs.push(`${node.kind} → ${slotKey}: only ${k.kind} is valid here — auto-applied`)
    autoResolveNode(child, logs, budget)
  }

  const properties = (batch.schema?.properties ?? {}) as Record<string, JsonSchema>
  const required = new Set((batch.schema?.required ?? []) as string[])
  const defs = (batch.schema?.$defs ?? {}) as Record<string, JsonSchema>

  for (const [slotKey, propSchema] of Object.entries(properties)) {
    if (budget.remaining <= 0) break
    const isRequired = required.has(slotKey)
    if (propSchema.type === 'array') {
      const candidates = stepCandidatesFromOneOf(stepSlotOneOf((propSchema.items ?? {}) as JsonSchema), defs)
      const min = typeof propSchema.minItems === 'number' ? propSchema.minItems : 0
      const max = typeof propSchema.maxItems === 'number' ? propSchema.maxItems : min + 2
      const cap = Math.min(max, min + 2, budget.remaining)
      const count = min >= cap ? min : min + Math.floor(Math.random() * (cap - min + 1))
      if (count === 0) {
        logs.push(`${node.kind} → ${slotKey}: auto-declined (optional, repeatable)`)
        continue
      }
      for (let i = 0; i < count && budget.remaining > 0; i++) {
        const candidate = pickRandom(candidates)
        const child: StepWorkingNode = { apiVersion: candidate.apiVersion, kind: candidate.kind, spec: stepFillNodeSpec(candidate.apiVersion, candidate.kind), slots: [] }
        stepAddChild(node, slotKey, child)
        budget.remaining -= 1
        logs.push(`${node.kind} → ${slotKey}[${i}]: auto-picked ${candidate.kind}`)
        autoResolveNode(child, logs, budget)
      }
    } else {
      if (!isRequired && Math.random() >= 0.6) {
        logs.push(`${node.kind} → ${slotKey}: auto-declined (optional)`)
        continue
      }
      const candidates = stepCandidatesFromOneOf(stepSlotOneOf(propSchema), defs)
      const candidate = pickRandom(candidates)
      const child: StepWorkingNode = { apiVersion: candidate.apiVersion, kind: candidate.kind, spec: stepFillNodeSpec(candidate.apiVersion, candidate.kind), slots: [] }
      stepAddChild(node, slotKey, child)
      budget.remaining -= 1
      logs.push(`${node.kind} → ${slotKey}: auto-picked ${candidate.kind}`)
      autoResolveNode(child, logs, budget)
    }
  }
}

function stepToResource(node: StepWorkingNode): Resource {
  const resource: Resource = { apiVersion: node.apiVersion, kind: node.kind, spec: node.spec }
  if (node.slots.length > 0) {
    resource.slots = node.slots.map((slot) => ({ ...(slot.name !== undefined ? { name: slot.name } : {}), items: slot.items.map(stepToResource) }))
  }
  return resource
}

/**
 * Replays a real, hand-authored example's actual structure through
 * `nextStageBatch` — for every slot in the real document, checks whether the
 * rule engine considers the kind actually used there valid. Directly answers
 * "does the rule engine agree with our real examples?" rather than assuming it.
 */
interface ReplayCheck {
  path: string
  parentKind: string
  slotKey: string
  actualKind: string
  validKinds: string[] | 'fixed'
  ok: boolean
}

function replayResource(resource: Resource, path = ''): ReplayCheck[] {
  const checks: ReplayCheck[] = []
  if (!resource.slots || resource.slots.length === 0) return checks

  const batch = nextStageBatch(stepScope, { parent: { apiVersion: resource.apiVersion, kind: resource.kind } })
  const defs = (batch.schema?.$defs ?? {}) as Record<string, JsonSchema>
  const properties = (batch.schema?.properties ?? {}) as Record<string, JsonSchema>

  for (const slot of resource.slots) {
    const slotKey = slot.name ?? '(default)'
    slot.items.forEach((child, index) => {
      const childPath = `${path}/slots/${slotKey}/${index}`
      const fixed = batch.fixed[slotKey]
      if (fixed) {
        checks.push({
          path: childPath,
          parentKind: resource.kind,
          slotKey,
          actualKind: child.kind,
          validKinds: 'fixed',
          ok: fixed.apiVersion === child.apiVersion && fixed.kind === child.kind,
        })
      } else {
        const propSchema = properties[slotKey]
        const candidateKinds = propSchema ? stepCandidatesFromOneOf(stepSlotOneOf(propSchema), defs).map((c) => c.kind) : []
        checks.push({ path: childPath, parentKind: resource.kind, slotKey, actualKind: child.kind, validKinds: candidateKinds, ok: candidateKinds.includes(child.kind) })
      }
      checks.push(...replayResource(child, childPath))
    })
  }
  return checks
}

function StepByStepBuilder() {
  const [root, setRoot] = useState<StepWorkingNode | null>(null)
  const [queue, setQueue] = useState<StepWorkingNode[]>([])
  const [openSlots, setOpenSlots] = useState<string[]>([])
  const [slotIndex, setSlotIndex] = useState(0)
  const [slotProperties, setSlotProperties] = useState<Record<string, JsonSchema>>({})
  const [slotRequired, setSlotRequired] = useState<Set<string>>(new Set())
  const [slotDefs, setSlotDefs] = useState<Record<string, JsonSchema>>({})
  const [currentSchema, setCurrentSchema] = useState<JsonSchema | null>(null)
  const [pendingChildren, setPendingChildren] = useState<StepWorkingNode[]>([])
  const [log, setLog] = useState<string[]>([])
  const [result, setResult] = useState<{ resource: Resource; validation: ValidationResult } | null>(null)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [candidateFilter, setCandidateFilter] = useState('')
  const [jsonSheetOpen, setJsonSheetOpen] = useState(false)

  const finalize = (rootNode: StepWorkingNode) => {
    const resource = stepToResource(rootNode)
    setResult({ resource, validation: validateResource(resource, stepScope) })
  }

  const runAutoSkip = (startQueue: StepWorkingNode[], rootNode: StepWorkingNode) => {
    let q = startQueue
    const newLogs: string[] = []
    while (q.length > 0) {
      const head = q[0]
      const batch = nextStageBatch(stepScope, { parent: { apiVersion: head.apiVersion, kind: head.kind } })
      const children: StepWorkingNode[] = []
      for (const [slotKey, k] of Object.entries(batch.fixed)) {
        const child: StepWorkingNode = { apiVersion: k.apiVersion, kind: k.kind, spec: stepFillNodeSpec(k.apiVersion, k.kind), slots: [] }
        stepAddChild(head, slotKey, child)
        children.push(child)
        newLogs.push(`${head.kind} → ${slotKey}: only ${k.kind} is valid here — auto-applied, no click needed`)
      }
      const properties = (batch.schema?.properties ?? {}) as Record<string, JsonSchema>
      const openKeys = Object.keys(properties)
      if (openKeys.length > 0) {
        setQueue(q)
        setOpenSlots(openKeys)
        setSlotIndex(0)
        setSlotProperties(properties)
        setSlotRequired(new Set((batch.schema?.required ?? []) as string[]))
        setSlotDefs((batch.schema?.$defs ?? {}) as Record<string, JsonSchema>)
        setCurrentSchema(batch.schema ?? null)
        setPendingChildren(children)
        setCandidateFilter('')
        setLog((l) => [...l, ...newLogs])
        return
      }
      q = [...q.slice(1), ...children]
    }
    setQueue([])
    setOpenSlots([])
    setCurrentSchema(null)
    setLog((l) => [...l, ...newLogs, `Done — every node resolved, no more open slots anywhere in the tree.`])
    finalize(rootNode)
  }

  const startRoot = (candidate: StepCandidate) => {
    const node: StepWorkingNode = { apiVersion: candidate.apiVersion, kind: candidate.kind, spec: stepFillNodeSpec(candidate.apiVersion, candidate.kind), slots: [] }
    setRoot(node)
    setResult(null)
    setLog([`root: you chose ${candidate.kind}`])
    runAutoSkip([node], node)
  }

  const advanceSlot = (children: StepWorkingNode[]) => {
    if (!root) return
    if (slotIndex + 1 < openSlots.length) {
      setSlotIndex(slotIndex + 1)
      setPendingChildren(children)
      setCandidateFilter('')
    } else {
      runAutoSkip([...queue.slice(1), ...children], root)
    }
  }

  const pickForSlot = (candidate: StepCandidate) => {
    const head = queue[0]
    const slotKey = openSlots[slotIndex]
    const child: StepWorkingNode = { apiVersion: candidate.apiVersion, kind: candidate.kind, spec: stepFillNodeSpec(candidate.apiVersion, candidate.kind), slots: [] }
    stepAddChild(head, slotKey, child)
    const nextPending = [...pendingChildren, child]
    setPendingChildren(nextPending)
    setLog((l) => [...l, `${head.kind} → ${slotKey}: you chose ${candidate.kind}`])

    const propSchema = slotProperties[slotKey]
    if (propSchema.type === 'array') {
      const realName = slotKey === '(default)' ? undefined : slotKey
      const count = head.slots.find((s) => s.name === realName)?.items.length ?? 0
      const maxItems = typeof propSchema.maxItems === 'number' ? propSchema.maxItems : Infinity
      if (count >= maxItems) advanceSlot(nextPending)
    } else {
      advanceSlot(nextPending)
    }
  }

  const skipSlot = () => {
    const head = queue[0]
    const slotKey = openSlots[slotIndex]
    setLog((l) => [...l, `${head.kind} → ${slotKey}: declined (optional, no item added)`])
    advanceSlot(pendingChildren)
  }

  const finishRepeatableSlot = () => {
    advanceSlot(pendingChildren)
  }

  const reset = () => {
    setRoot(null)
    setQueue([])
    setOpenSlots([])
    setLog([])
    setResult(null)
    setCurrentSchema(null)
    setCandidateFilter('')
  }

  const rootStage = useMemo(() => nextStage(stepScope, {}), [])
  const rootDefs = (rootStage.schema?.$defs ?? {}) as Record<string, JsonSchema>
  const rootCandidates = rootStage.schema ? stepCandidatesFromOneOf((rootStage.schema.oneOf as JsonSchema[]) ?? [], rootDefs) : []

  const autoGenerate = () => {
    const rootCandidate = rootStage.fixed
      ? { apiVersion: rootStage.fixed.apiVersion, kind: rootStage.fixed.kind }
      : pickRandom(rootCandidates)
    const node: StepWorkingNode = {
      apiVersion: rootCandidate.apiVersion,
      kind: rootCandidate.kind,
      spec: stepFillNodeSpec(rootCandidate.apiVersion, rootCandidate.kind),
      slots: [],
    }
    const logs = [`root: auto-picked ${rootCandidate.kind}`]
    autoResolveNode(node, logs, { remaining: 60 })
    logs.push('Done — auto-generated end to end, no clicks.')
    setRoot(node)
    setQueue([])
    setOpenSlots([])
    setCurrentSchema(null)
    setCandidateFilter('')
    setLog(logs)
    finalize(node)
  }

  const filterCandidates = (candidates: StepCandidate[]) => {
    if (!candidateFilter.trim()) return candidates
    const needle = candidateFilter.trim().toLowerCase()
    return candidates.filter((c) => c.kind.toLowerCase().includes(needle) || (c.description ?? '').toLowerCase().includes(needle))
  }

  if (!root) {
    if (rootStage.fixed) {
      return (
        <div className="rk-step-panel">
          <p>
            Only one root-eligible kind in this scope: <strong>{rootStage.fixed.kind}</strong>.
          </p>
          <Button size="sm" onClick={() => startRoot({ apiVersion: rootStage.fixed!.apiVersion, kind: rootStage.fixed!.kind })}>
            Start
          </Button>
        </div>
      )
    }
    const filteredRoot = filterCandidates(rootCandidates)
    return (
      <div className="rk-step-panel">
        <div className="rk-step-auto-row">
          <p className="rk-step-slot-desc">
            Want a finished example instead of clicking through every region yourself? This runs the exact same{' '}
            <code>nextStage</code>/<code>nextStageBatch</code> loop, just with a random pick at each decision instead
            of a click — a random result every time.
          </p>
          <Button size="sm" variant="outline" onClick={autoGenerate}>
            <Sparkles />
            Auto-generate a full example
          </Button>
        </div>
        <p className="rk-step-prompt">Or pick a root template yourself and build it one decision at a time:</p>
        {rootCandidates.length > 8 ? (
          <input
            className="rk-step-filter"
            placeholder={`Filter ${rootCandidates.length} options...`}
            value={candidateFilter}
            onChange={(event) => setCandidateFilter(event.target.value)}
          />
        ) : null}
        <div className="rk-step-candidates rk-step-candidates-scroll">
          {filteredRoot.map((candidate) => (
            <button key={candidate.kind} className="rk-step-candidate" onClick={() => startRoot(candidate)}>
              <strong>{candidate.kind}</strong>
              {candidate.description ? <span>{candidate.description}</span> : null}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const currentSlotKey = openSlots[slotIndex]
  const currentPropSchema = currentSlotKey ? slotProperties[currentSlotKey] : undefined
  const currentCandidates = currentPropSchema ? stepCandidatesFromOneOf(stepSlotOneOf(currentPropSchema), slotDefs) : []
  const filteredCandidates = filterCandidates(currentCandidates)
  const isRepeatable = currentPropSchema?.type === 'array'
  const isRequired = currentSlotKey ? slotRequired.has(currentSlotKey) : false
  const head = queue[0]
  const liveResource = stepToResource(root)

  const renderCandidatePicker = () => (
    <div className="rk-tree-picker">
      {currentPropSchema?.description ? <p className="rk-step-slot-desc">{currentPropSchema.description as string}</p> : null}
      {isRepeatable ? <p className="rk-step-slot-desc">Repeatable — add as many as you like.</p> : null}
      {currentCandidates.length > 8 ? (
        <input
          className="rk-step-filter"
          placeholder={`Filter ${currentCandidates.length} options...`}
          value={candidateFilter}
          onChange={(event) => setCandidateFilter(event.target.value)}
        />
      ) : null}
      <div className="rk-step-candidates rk-step-candidates-scroll">
        {filteredCandidates.map((candidate) => (
          <button key={candidate.kind} className="rk-step-candidate" onClick={() => pickForSlot(candidate)}>
            <strong>{candidate.kind}</strong>
            {candidate.description ? <span>{candidate.description}</span> : null}
          </button>
        ))}
        {filteredCandidates.length === 0 ? <p className="rk-step-slot-desc">No options match "{candidateFilter}".</p> : null}
      </div>
      <div className="rk-pane-actions">
        {!isRequired && !isRepeatable ? (
          <Button size="sm" variant="outline" onClick={skipSlot}>
            Skip this slot
          </Button>
        ) : null}
        {isRepeatable ? (
          <Button size="sm" variant="outline" onClick={finishRepeatableSlot}>
            Done with this slot
          </Button>
        ) : null}
      </div>
      <button className="rk-step-raw-toggle" onClick={() => setSchemaOpen(!schemaOpen)} type="button">
        {schemaOpen ? '▾' : '▸'} What the real nextStageBatch request looks like for this whole region set
      </button>
      {schemaOpen ? (
        <div className="rk-editor-shell rk-step-editor">
          <JsonEditor value={currentSchema ? prettyJson(currentSchema) : ''} readOnly />
        </div>
      ) : null}
    </div>
  )

  const renderOpenSlotsFor = (node: StepWorkingNode, depth: number): React.ReactNode => {
    if (node !== head) return null
    return openSlots.map((key, index) => {
      const alreadyResolved = node.slots.some((s) => (s.name ?? '(default)') === key)
      if (alreadyResolved) return null
      const rowStyle = { marginLeft: depth * 20 }
      if (index < slotIndex) {
        return (
          <div key={key} className="rk-tree-row rk-tree-row-declined" style={rowStyle}>
            <code>{key}</code> — declined (optional, no item added)
          </div>
        )
      }
      if (index === slotIndex) {
        return (
          <div key={key} className="rk-tree-row rk-tree-row-active" style={rowStyle}>
            <div className="rk-tree-row-label">
              👉 <code>{key}</code> — pick one:
            </div>
            {renderCandidatePicker()}
          </div>
        )
      }
      return (
        <div key={key} className="rk-tree-row rk-tree-row-pending" style={rowStyle}>
          <code>{key}</code> — not yet (comes after {openSlots[slotIndex]})
        </div>
      )
    })
  }

  const renderNode = (node: StepWorkingNode, label: string | null, depth: number): React.ReactNode => (
    <div key={`${label ?? 'root'}-${depth}-${node.kind}`} className="rk-tree-node">
      <div className="rk-tree-row rk-tree-row-resolved" style={{ marginLeft: depth * 20 }}>
        {label ? (
          <>
            <code>{label}</code> →{' '}
          </>
        ) : null}
        <strong>{node.kind}</strong>
      </div>
      {node.slots.map((slot) => slot.items.map((child, i) => renderNode(child, slot.name ?? '(default)', depth + 1)))}
      {renderOpenSlotsFor(node, depth + 1)}
    </div>
  )

  return (
    <div className="rk-step-panel">
      <p className="rk-step-prompt">
        Every region of the template you're building is shown below, in place — filled-in regions show what you
        picked, <strong>👉 marks the one you're deciding right now</strong>, and greyed-out regions are still
        waiting their turn. Nested regions (a region's own sub-regions) appear indented underneath it.
      </p>
      <div className="rk-tree">{renderNode(root, null, 0)}</div>

      <div className="rk-step-live">
        <div className="rk-step-live-header">
          <div className="rk-step-log-title">Actual rendered UI so far</div>
          <Button size="sm" variant="outline" onClick={() => setJsonSheetOpen(true)}>
            <Braces />
            Show JSON
          </Button>
        </div>
        {result ? (
          <div className={result.validation.valid ? 'rk-workflow-validation-ok' : 'rk-workflow-validation-error'}>
            {result.validation.valid ? '✓ validateResource: valid — this is the finished document' : `✗ invalid: ${result.validation.issues.map((issue) => issue.message).join('; ')}`}
          </div>
        ) : (
          <p className="rk-step-slot-desc">Still building — the tree above still has a 👉 region, so this preview is incomplete.</p>
        )}
        <div className="rk-render-body rk-step-live-render">
          <ResourceRenderer
            registry={registry}
            renderError={(err) => <div className="fallback">{err instanceof Error ? err.message : 'Render error'}</div>}
            renderLoading={() => <div className="fallback">Loading kind...</div>}
            renderUnknownKind={(res) => <div className="fallback">Unknown kind: {res.kind}</div>}
            resource={liveResource}
          />
        </div>
      </div>

      <div className="rk-step-btn-row">
        <Button size="sm" variant="outline" onClick={reset}>
          Start over
        </Button>
        {!openSlots.length ? (
          <Button size="sm" variant="outline" onClick={autoGenerate}>
            <Sparkles />
            Auto-generate another random example
          </Button>
        ) : null}
      </div>
      <div className="rk-step-log-title">What happened so far</div>
      <ol className="rk-workflow-call-log">
        {log.map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ol>

      <Sheet open={jsonSheetOpen} onOpenChange={setJsonSheetOpen}>
        <SheetContent side="right" className="rk-json-sheet-content">
          <SheetHeader className="rk-json-sheet-header">
            <div>
              <SheetTitle className="rk-json-sheet-title">Document so far — JSON</SheetTitle>
              <p className="rk-json-sheet-description">Updates live as you make choices; not the final document until every slot is resolved.</p>
            </div>
          </SheetHeader>
          <div className="rk-editor-shell">
            <JsonEditor value={prettyJson(liveResource)} readOnly />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function ReplayCheckPanel() {
  const [checks, setChecks] = useState<ReplayCheck[] | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const run = () => setChecks(replayResource(workbenchTemplate))
  const allOk = checks ? checks.every((c) => c.ok) : false

  return (
    <div className="rk-step-panel">
      <p className="rk-step-prompt">
        <strong>Why this exists:</strong> the left panel lets you hand-pick kinds yourself, but that doesn't prove
        the rule engine matches how a <em>real</em> document is actually built. <code>workbenchTemplate</code> (the
        "Workbench template" example already rendering live in the "Resource runtime" tab) was hand-authored before
        any of this — it never went through <code>nextStageBatch</code>. This button walks that real example's
        actual structure and checks, slot by slot, whether <code>nextStageBatch</code> would have allowed the exact
        kind it uses. If they all pass, the rule engine agrees with a document nobody built through it.
      </p>
      <Button size="sm" onClick={run}>
        Replay workbenchTemplate
      </Button>
      {checks ? (
        <>
          <p className={allOk ? 'rk-workflow-validation-ok' : 'rk-workflow-validation-error'}>
            {allOk
              ? `✓ all ${checks.length} slot picks in the real example are valid under the rule engine`
              : `✗ ${checks.filter((c) => !c.ok).length} of ${checks.length} mismatched`}
          </p>
          <div className="rk-step-log-title">The real, rendered workbenchTemplate — exactly as it shows in "Resource runtime"</div>
          <div className="rk-render-body rk-step-live-render">
            <ResourceRenderer
              registry={registry}
              renderError={(err) => <div className="fallback">{err instanceof Error ? err.message : 'Render error'}</div>}
              renderLoading={() => <div className="fallback">Loading kind...</div>}
              renderUnknownKind={(res) => <div className="fallback">Unknown kind: {res.kind}</div>}
              resource={workbenchTemplate}
            />
          </div>
          <div className="rk-step-raw">
            <button className="rk-step-raw-toggle" onClick={() => setDetailsOpen(!detailsOpen)} type="button">
              {detailsOpen ? '▾' : '▸'} Slot-by-slot detail ({checks.length} checks)
            </button>
            {detailsOpen ? (
              <ol className="rk-workflow-call-log">
                {checks.map((check) => (
                  <li key={check.path}>
                    {check.ok ? '✓' : '✗'} <code>{check.parentKind}</code> → <code>{check.slotKey}</code>: real
                    example uses <strong>{check.actualKind}</strong>
                    {check.validKinds === 'fixed'
                      ? ' (rule engine: deterministic, only this kind is valid)'
                      : check.ok
                        ? ` (rule engine: valid — one of ${check.validKinds.join(', ')})`
                        : ` (rule engine says valid options are: ${check.validKinds.join(', ') || '(none)'})`}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

function StepByStepDemo() {
  const [replayOpen, setReplayOpen] = useState(false)
  return (
    <div className="rk-step-demo">
      <p className="rk-workflow-demo-note">
        This calls <code>nextStage</code>/<code>nextStageBatch</code> directly — no pre-built loop, no mock model.
        You're doing what an MCP client would do itself: get a schema back, make a choice, get the next schema back.
      </p>
      <StepByStepBuilder />

      <div className="rk-step-replay-divider">
        <button className="rk-step-raw-toggle" onClick={() => setReplayOpen(!replayOpen)} type="button">
          {replayOpen ? '▾' : '▸'} Separate check: does a real, already-built example agree with this? (not
          connected to what you're building above)
        </button>
        {replayOpen ? <ReplayCheckPanel /> : null}
      </div>
    </div>
  )
}

const shellStyle = {
  '--sidebar-width': '260px',
  '--sidebar-width-icon': '56px',
} as CSSProperties

function exampleById(id: string | null | undefined): (typeof examples)[number] {
  return examples.find((example) => example.id === id) ?? examples[0]
}

function initialExample(): (typeof examples)[number] {
  if (typeof window === 'undefined') return examples[0]
  return exampleById(new URLSearchParams(window.location.search).get('sample'))
}

function writeSampleUrl(exampleId: string): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('sample', exampleId)
  window.history.pushState({}, '', url)
}

function ExampleSelect({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) {
  const selectedExample = examples.find((example) => example.id === value) ?? examples[0]
  return (
    <Select
      value={selectedExample.name}
      onValueChange={(name) => {
        const example = examples.find((item) => item.name === name)
        if (example) onValueChange(example.id)
      }}
    >
      <SelectTrigger className="rk-example-select" aria-label="Example sample">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {examples.map((example) => (
          <SelectItem key={example.id} value={example.name}>
            {example.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function JsonEditor({ value, onChange, readOnly = false }: { value: string; onChange?: (value: string) => void; readOnly?: boolean }) {
  return (
    <CodeMirror
      basicSetup={{
        bracketMatching: true,
        foldGutter: true,
        highlightActiveLine: true,
        lineNumbers: true,
      }}
      editable={!readOnly}
      extensions={[json()]}
      height="100%"
      onChange={onChange}
      theme={oneDark}
      value={value}
    />
  )
}

const styles = `
  :root {
    color: var(--foreground);
    background: var(--background);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  body {
    margin: 0;
  }
  body, #root {
    width: 100%;
    height: 100vh;
    min-height: 100vh;
    overflow: hidden;
  }
  .rk-app {
    width: 100%;
    height: 100vh;
    min-height: 100vh;
    overflow: hidden;
    background: var(--background);
    color: var(--foreground);
    box-sizing: border-box;
  }
  .rk-app [data-slot="sidebar-wrapper"] {
    height: 100vh;
    min-height: 100vh;
    overflow: hidden;
  }
  .rk-app [data-slot="sidebar"] {
    height: 100vh;
    min-height: 100vh;
  }
  h1, h2, h3, p {
    margin: 0;
  }
  .rk-brand {
    display: grid;
    gap: 4px;
    padding: 4px 2px;
  }
  .rk-brand-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0;
  }
  .rk-brand-subtitle {
    color: var(--muted-foreground);
    font-size: 12px;
    line-height: 1.35;
  }
  .rk-shell-main {
    min-width: 0;
    height: 100vh;
    min-height: 0;
    overflow: hidden;
    background: var(--background);
  }
  .rk-runtime {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100vh;
    min-height: 0;
    overflow: hidden;
  }
  .rk-section-title {
    display: grid;
    gap: 2px;
  }
  .rk-section-title h2 {
    font-size: 14px;
    font-weight: 700;
  }
  .rk-section-title p {
    color: var(--muted-foreground);
    font-size: 12px;
  }
  .rk-example-select {
    min-width: 260px;
  }
  .rk-panel {
    min-height: 0;
  }
  .rk-workbench {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    height: 100vh;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .rk-render-pane {
    min-width: 0;
    height: 100vh;
    min-height: 0;
  }
  .rk-pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 54px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--background);
  }
  .rk-pane-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .rk-editor-shell {
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .rk-editor-shell .cm-editor {
    height: 100%;
    min-height: 560px;
    max-width: 100%;
    font-size: 12px;
  }
  .rk-editor-shell .cm-scroller {
    overflow: auto;
    overscroll-behavior: contain;
  }
  .rk-editor-shell .cm-content {
    min-width: 0;
  }
  .rk-render-pane {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: auto;
    background: var(--background);
  }
  .rk-render-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 54px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--background);
  }
  .rk-render-body {
    min-height: 0;
    padding: 16px;
    box-sizing: border-box;
  }
  .rk-render-body > * {
    min-width: 0;
  }
  .rk-render-body .layout-databody [data-slot="data-page-tabs"],
  .rk-render-body .layout-databody > .shrink-0.border-b,
  .rk-render-body .layout-list-detail aside,
  .rk-render-body .layout-list-detail main > .border-b,
  .rk-render-body .resourcekit-selectable-list > button {
    border-color: var(--border) !important;
  }
  .rk-render-body .layout-databody [data-slot="data-page-tab"][data-active="true"] {
    border-bottom-color: var(--primary) !important;
  }
  .rk-render-body .resourcekit-selectable-list {
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .rk-json-sheet-content {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: min(760px, calc(100vw - 32px));
    max-width: min(760px, calc(100vw - 32px));
    height: 100vh;
    min-height: 0;
    padding: 0;
    overflow: hidden;
    overscroll-behavior: contain;
  }
  .rk-json-sheet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 56px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--background);
  }
  .rk-json-sheet-title {
    font-size: 14px;
    font-weight: 700;
  }
  .rk-json-sheet-description {
    color: var(--muted-foreground);
    font-size: 12px;
    line-height: 1.4;
  }
  .rk-json-sheet-content .rk-editor-shell {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .rk-json-sheet-content .rk-editor-shell .cm-editor {
    height: calc(100vh - 57px) !important;
    max-height: calc(100vh - 57px);
    min-height: 0;
  }
  .rk-json-sheet-content .rk-editor-shell .cm-scroller {
    height: 100%;
    max-height: calc(100vh - 57px);
    overflow: auto;
  }
  .rk-message {
    margin: 16px;
    border: 1px solid var(--destructive);
    background: var(--muted);
    padding: 12px;
    color: var(--destructive);
    font-size: 13px;
    white-space: pre-wrap;
  }
  .rk-workflow-demo-title {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
  }
  .rk-workflow-demo-note {
    font-size: 13px;
    color: var(--muted-foreground);
    margin: 0 0 12px;
  }
  .rk-workflow-demo-note code {
    background: var(--muted);
    padding: 1px 4px;
    border-radius: 4px;
  }
  .rk-workflow-call-log {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0;
    margin: 8px 0 0;
    list-style: none;
  }
  .rk-workflow-call-log li {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
  }
  .rk-workflow-call-log code {
    background: var(--muted);
    padding: 1px 4px;
    border-radius: 4px;
  }
  .rk-workflow-validation-ok {
    color: var(--primary);
    font-size: 13px;
    font-weight: 500;
  }
  .rk-workflow-validation-error {
    color: var(--destructive);
    font-size: 13px;
    font-weight: 500;
    white-space: pre-wrap;
  }
  .rk-workflow-result {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
    margin-top: 12px;
  }
  .rk-step-demo {
    padding: 16px;
    max-width: 1200px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .rk-step-replay-divider {
    border-top: 2px dashed var(--border);
    padding-top: 16px;
  }
  .rk-step-panel {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .rk-step-main {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .rk-step-auto-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    border: 1px dashed var(--border);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .rk-step-auto-row .rk-step-slot-desc {
    margin: 0;
    font-size: 12px;
    flex: 1;
    min-width: 220px;
  }
  .rk-step-auto-row button svg {
    width: 14px;
    height: 14px;
  }
  .rk-step-btn-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .rk-step-btn-row button svg {
    width: 14px;
    height: 14px;
  }
  .rk-step-prompt {
    font-size: 13px;
    margin: 0;
  }
  .rk-step-prompt code {
    background: var(--muted);
    padding: 1px 4px;
    border-radius: 4px;
  }
  .rk-step-slot-desc {
    color: var(--muted-foreground);
    font-weight: 400;
  }
  .rk-step-candidates {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rk-step-candidate {
    text-align: left;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    background: var(--background);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
  }
  .rk-step-candidate:hover {
    background: var(--muted);
  }
  .rk-step-candidate span {
    font-size: 12px;
    color: var(--muted-foreground);
    font-weight: 400;
  }
  .rk-step-sidebar {
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .rk-step-log-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .rk-step-raw {
    border-top: 1px dashed var(--border);
    padding-top: 8px;
  }
  .rk-step-raw-toggle {
    background: none;
    border: none;
    padding: 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .rk-step-editor {
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .rk-step-editor .cm-editor {
    min-height: 160px;
  }
  .rk-step-live {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    background: var(--background);
  }
  .rk-step-live-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .rk-step-live-render {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    min-height: 360px;
    max-height: 640px;
    overflow: auto;
  }
  .rk-step-filter {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 13px;
    background: var(--background);
    color: inherit;
  }
  .rk-step-candidates-scroll {
    max-height: 320px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .rk-tree {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }
  .rk-tree-node {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rk-tree-row {
    padding: 6px 10px;
    border-radius: 6px;
  }
  .rk-tree-row code {
    background: var(--muted);
    padding: 1px 4px;
    border-radius: 4px;
  }
  .rk-tree-row-resolved {
    background: var(--muted);
  }
  .rk-tree-row-declined {
    color: var(--muted-foreground);
    font-style: italic;
  }
  .rk-tree-row-pending {
    color: var(--muted-foreground);
    border: 1px dashed var(--border);
  }
  .rk-tree-row-active {
    border: 2px solid var(--primary);
    background: var(--background);
    padding: 10px;
  }
  .rk-tree-row-label {
    font-weight: 600;
    margin-bottom: 6px;
  }
  .rk-tree-picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rk-json-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100vh;
    min-height: 0;
    background: var(--background);
  }
  .rk-json-panel .cm-editor {
    min-height: 0;
    height: calc(100vh - 56px);
    font-size: 12px;
  }
  .rk-inspector {
    margin: 16px;
    border: 1px solid var(--border);
    background: var(--background);
  }
  .rk-inspector-header {
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  .rk-inspector pre {
    max-height: calc(100vh - 230px);
    margin: 0;
    overflow: auto;
    padding: 16px;
    color: var(--foreground);
    font-size: 12px;
    line-height: 1.55;
  }
  .resourcekit-text {
    color: var(--muted-foreground);
    line-height: 1.5;
  }
  .resourcekit-state {
    padding: 16px;
    color: var(--muted-foreground);
  }
  .fallback {
    padding: 12px;
    border: 1px solid var(--destructive);
    background: var(--muted);
  }
  .rk-toast {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 100;
    padding: 10px 16px;
    border-radius: var(--radius);
    background: var(--foreground);
    color: var(--background);
    font-size: 13px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
  }
  @media (max-width: 1040px) {
    .rk-render-toolbar {
      align-items: flex-start;
      flex-direction: column;
    }
    .rk-pane-actions {
      justify-content: flex-start;
    }
  }
`

export function App() {
  useStyleInjector()

  const [view, setView] = useState<'runtime' | 'step-by-step'>('runtime')
  const [selectedExampleId, setSelectedExampleId] = useState<(typeof examples)[number]['id']>(() => initialExample().id)
  const [resource, setResource] = useState<Resource>(() => initialExample().resource)
  const [loadError, setLoadError] = useState<string>()
  const [jsonSheetOpen, setJsonSheetOpen] = useState(false)
  const [aiTraceSheetOpen, setAiTraceSheetOpen] = useState(false)
  const [toast, setToast] = useState<string>()

  // External hook: documents emit events; the app decides what they mean.
  const handleDocumentEvent = (event: string, payload?: unknown) => {
    if (event === 'users.created') {
      const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
      setToast(`${String(record.name ?? 'Member')} added to the team`)
      window.setTimeout(() => setToast(undefined), 3500)
    }
  }

  const resourceJson = useMemo(() => prettyJson(resource), [resource])

  // The real nextStage/nextStageBatch trace for whatever resource is loaded —
  // not a one-shot "here's the whole schema, generate a document" dump (that
  // model was rejected; see docs/staged-generation-experiment.md "Final
  // decision"). Reuses the same replay logic the Step-by-step tab uses to
  // check hand-authored examples against the rule engine.
  const aiTraceRoot = useMemo(() => {
    // playgroundScope (not stepScope's rootLevels:['template']) — some Resource
    // runtime examples are intentionally smaller fragments (e.g. a bare Panel),
    // not whole-page templates, and are still valid roots in this tab's own scope.
    const stage = nextStage(playgroundScope, {})
    if (stage.fixed) return { onlyOption: true as const, ok: stage.fixed.kind === resource.kind, candidateKinds: [stage.fixed.kind] }
    const defs = (stage.schema?.$defs ?? {}) as Record<string, JsonSchema>
    const candidateKinds = (stage.schema ? stepCandidatesFromOneOf((stage.schema.oneOf as JsonSchema[]) ?? [], defs) : []).map((c) => c.kind)
    return { onlyOption: false as const, ok: candidateKinds.includes(resource.kind), candidateKinds }
  }, [resource.kind])
  const aiTraceChecks = useMemo(() => replayResource(resource), [resource])

  useEffect(() => {
    const onPopState = () => {
      const example = exampleById(new URLSearchParams(window.location.search).get('sample'))
      setSelectedExampleId(example.id)
      setResource(example.resource)
      setLoadError(undefined)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const selectExample = (example: (typeof examples)[number]) => {
    setSelectedExampleId(example.id)
    setResource(example.resource)
    setLoadError(undefined)
    writeSampleUrl(example.id)
  }

  const selectExampleById = (id: string) => {
    const example = examples.find((item) => item.id === id)
    if (example) selectExample(example)
  }

  const renderOutput = (
    <>
      {loadError ? <pre className="rk-message">{loadError}</pre> : null}
      <ResourceRenderer
        registry={registry}
        onEvent={handleDocumentEvent}
        renderError={(error) => <div className="fallback">{error instanceof Error ? error.message : 'Render error'}</div>}
        renderLoading={() => <div className="fallback">Loading kind...</div>}
        renderUnknownKind={(resource) => <div className="fallback">Unknown kind: {resource.kind}</div>}
        resource={resource}
      />
      {toast && <div className="rk-toast">{toast}</div>}
    </>
  )

  return (
    <main className="rk-app">
      <style>{styles}</style>
      <SidebarProvider defaultOpen style={shellStyle}>
        <Sidebar collapsible="none">
          <SidebarHeader>
            <div className="flex items-center gap-2 px-2 py-1">
              <div className="h-7 w-7 rounded-(--radius) bg-primary flex items-center justify-center text-primary-foreground font-bold text-xs">
                R
              </div>
              <div className="rk-brand">
                <div className="rk-brand-title">resourcekit</div>
                <div className="rk-brand-subtitle">JSON resource runtime</div>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Playground</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={view === 'runtime'} type="button" onClick={() => setView('runtime')}>
                      <LayoutDashboard />
                      <span>Resource runtime</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={view === 'step-by-step'} type="button" onClick={() => setView('step-by-step')}>
                      <Route />
                      <span>Step-by-step generation</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset className="rk-shell-main">
          <section className="rk-runtime">
            <section className="rk-panel">
              <div className="rk-workbench">
                {view === 'step-by-step' ? (
                  <section className="rk-render-pane">
                    <div className="rk-render-toolbar">
                      <h2 className="rk-workflow-demo-title">Step-by-step generation</h2>
                    </div>
                    <div className="rk-render-body">
                      <StepByStepDemo />
                    </div>
                  </section>
                ) : (
                  <section className="rk-render-pane">
                    <div className="rk-render-toolbar">
                      <ExampleSelect value={selectedExampleId} onValueChange={selectExampleById} />
                      <div className="rk-pane-actions">
                        <Button size="sm" variant="outline" onClick={() => setAiTraceSheetOpen(true)}>
                          <Sparkles />
                          How AI builds this
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setJsonSheetOpen(true)}>
                          <Braces />
                          Show JSON
                        </Button>
                      </div>
                    </div>
                    <div className="rk-render-body">{renderOutput}</div>
                  </section>
                )}
                <Sheet open={jsonSheetOpen} onOpenChange={setJsonSheetOpen}>
                  <SheetContent side="right" className="rk-json-sheet-content">
                    <SheetHeader className="rk-json-sheet-header">
                      <div>
                        <SheetTitle className="rk-json-sheet-title">Resource JSON</SheetTitle>
                        <p className="rk-json-sheet-description">The selected sample document rendered on the page.</p>
                      </div>
                    </SheetHeader>
                    <div className="rk-editor-shell">
                      <JsonEditor value={resourceJson} readOnly />
                    </div>
                  </SheetContent>
                </Sheet>
                <Sheet open={aiTraceSheetOpen} onOpenChange={setAiTraceSheetOpen}>
                  <SheetContent side="right" className="rk-json-sheet-content">
                    <SheetHeader className="rk-json-sheet-header">
                      <div>
                        <SheetTitle className="rk-json-sheet-title">How AI builds this</SheetTitle>
                        <p className="rk-json-sheet-description">
                          The real nextStage/nextStageBatch trace for this document — not a one-shot "here's the
                          whole schema, generate a document" request. This is what an MCP client actually sees and
                          decides, one position at a time.
                        </p>
                      </div>
                    </SheetHeader>
                    <div className="rk-step-panel">
                      <p className={aiTraceRoot.ok ? 'rk-workflow-validation-ok' : 'rk-workflow-validation-error'}>
                        {aiTraceRoot.onlyOption
                          ? `root: only ${aiTraceRoot.candidateKinds[0]} is a valid root here — no choice needed`
                          : !aiTraceRoot.ok
                            ? `root: ${resource.kind} is NOT a valid root per the rule engine (valid options: ${aiTraceRoot.candidateKinds.join(', ') || '(none)'})`
                            : aiTraceRoot.candidateKinds.length > 8
                              ? `root: chose ${resource.kind} (valid — this scope has no root restriction, so any of the ${aiTraceRoot.candidateKinds.length} registered kinds qualify)`
                              : `root: chose ${resource.kind} (valid — one of ${aiTraceRoot.candidateKinds.join(', ')})`}
                      </p>
                      {aiTraceChecks.length > 0 ? (
                        <ol className="rk-workflow-call-log">
                          {aiTraceChecks.map((check) => (
                            <li key={check.path}>
                              {check.ok ? '✓' : '✗'} <code>{check.parentKind}</code> → <code>{check.slotKey}</code>:
                              chose <strong>{check.actualKind}</strong>
                              {check.validKinds === 'fixed'
                                ? ' (only this kind is valid here)'
                                : check.ok
                                  ? ` (valid — one of ${check.validKinds.join(', ')})`
                                  : ` (rule engine says valid options are: ${check.validKinds.join(', ') || '(none)'})`}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="rk-step-slot-desc">This document has no slots — nothing to resolve beyond the root.</p>
                      )}
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </section>
          </section>
        </SidebarInset>
      </SidebarProvider>
    </main>
  )
}
