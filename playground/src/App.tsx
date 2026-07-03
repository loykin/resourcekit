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
import { Braces, LayoutDashboard, Sparkles } from 'lucide-react'
import { buildDocumentSchema, createRegistry, restResolver, staticResolver, validateResource } from '@loykin/resourcekit'
import type { DataResolver, LoykinResource, MutationResolver } from '@loykin/resourcekit'
import { ResourceRenderer } from '@loykin/resourcekit/react'
import type { KindRenderFn } from '@loykin/resourcekit/react'
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

function jsonDataUrl(value: unknown): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify(value))}`
}

const playgroundDatasourceResolver: DataResolver = async (binding) => {
  if (binding.source !== 'datasource' || binding.datasourceUid !== 'crm') return []
  const query = typeof binding.query === 'object' && binding.query !== null ? (binding.query as Record<string, unknown>) : {}
  const status = typeof query.status === 'string' ? query.status : undefined
  const id = typeof query.id === 'string' ? query.id : undefined
  return customerRows.filter((row) => (!status || row.status === status) && (!id || row.id === id))
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

const customerWorkspace: LoykinResource = {
  apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'PageTopBar',
          spec: { left: 'Customers', height: '76px' },
          slots: [
            {
              name: 'right',
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
                  kind: 'DataBody',
                  spec: {
                    title: 'Customer profile',
                    description: 'Selected record rendered through a scoped detail view.',
                  },
                  slots: [
                    {
                      children: [
                        {
                          apiVersion: 'loykin.dev/v1alpha1',
                          kind: 'DataBodyGroup',
                          spec: { title: 'Overview', layout: 'inline', variant: 'plain' },
                          slots: [
                            {
                              children: [
                                {
                                  apiVersion: 'loykin.dev/v1alpha1',
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
                          apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'No customer selected' },
          slots: [
            {
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
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

const metricsChart: LoykinResource = {
  apiVersion: 'loykin.dev/v1alpha1',
  kind: 'Panel',
  metadata: { name: 'monthly-revenue' },
  spec: { title: 'Monthly revenue', eyebrow: 'ChartKit example' },
  slots: [
    {
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Text',
          spec: { text: 'A smaller resource document that renders one chart leaf.' },
        },
        {
          apiVersion: 'loykin.dev/v1alpha1',
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

const chartGallery: LoykinResource = {
  apiVersion: 'loykin.dev/v1alpha1',
  kind: 'Workbench',
  metadata: { name: 'chart-gallery' },
  spec: { leftWidth: 360, rightWidth: 360 },
  slots: [
    {
      name: 'topBar',
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Chart gallery', eyebrow: 'ChartKit specs rendered from JSON' },
        },
      ],
    },
    {
      name: 'leftPane',
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Donut' },
          slots: [
            {
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Time series' },
          slots: [
            {
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Stat' },
          slots: [
            {
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
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
                  apiVersion: 'loykin.dev/v1alpha1',
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

const workbenchTemplate: LoykinResource = {
  apiVersion: 'loykin.dev/v1alpha1',
  kind: 'Workbench',
  metadata: { name: 'operations-workbench' },
  spec: { leftWidth: 320, rightWidth: 340 },
  slots: [
    {
      name: 'topBar',
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Operations workbench', eyebrow: 'Workbench' },
        },
      ],
    },
    {
      name: 'leftPane',
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'DataBody',
          spec: { title: 'Queue', description: 'Compact side content.' },
          slots: [
            {
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
                  kind: 'DataBodyGroup',
                  spec: { title: 'Counts', variant: 'bordered' },
                  slots: [
                    {
                      children: [
                        {
                          apiVersion: 'loykin.dev/v1alpha1',
                          kind: 'DataBodyField',
                          spec: { label: 'Open', value: '24' },
                        },
                        {
                          apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Throughput' },
          slots: [
            {
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
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

const fromValueBinding: LoykinResource = {
  apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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
          apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'DataBody',
          spec: { title: 'Runtime variable' },
          slots: [
            {
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
                  kind: 'DataBodyGroup',
                  spec: { title: 'Selected plan', layout: 'inline', variant: 'bordered' },
                  slots: [
                    {
                      children: [
                        {
                          apiVersion: 'loykin.dev/v1alpha1',
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

const fromRowBinding: LoykinResource = {
  apiVersion: 'loykin.dev/v1alpha1',
  kind: 'ListDetail',
  metadata: { name: 'from-row-binding' },
  spec: {
    listWidth: 420,
    selectionVariable: 'ticketId',
    variables: [{ name: 'ticketId', type: 'string', default: 'INC-1001' }],
  },
  slots: [
    {
      name: 'list',
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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
      name: 'detail',
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Selected incident', eyebrow: 'from: row.id' },
          slots: [
            {
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
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

const restDataTable: LoykinResource = {
  apiVersion: 'loykin.dev/v1alpha1',
  kind: 'DataBody',
  metadata: { name: 'rest-data-table' },
  spec: { title: 'Users', description: 'Rows resolved through source: "rest" and rowsPath.' },
  slots: [
    {
      name: 'actions',
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'ActionButton',
          spec: { label: 'Export', size: 'sm', variant: 'outline' },
        },
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'ActionButton',
          spec: { label: 'Add User', size: 'sm' },
        },
      ],
    },
    {
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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

const datasourceDataTable: LoykinResource = {
  apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'ActionButton',
          spec: { label: 'Sync', size: 'sm', variant: 'outline' },
        },
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'ActionButton',
          spec: { label: 'Add Customer', size: 'sm' },
        },
      ],
    },
    {
      name: 'toolbarLeft',
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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

const userManagement: LoykinResource = {
  apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Sheet',
          spec: { openVariable: 'createOpen', title: 'Add member', width: 440 },
          slots: [
            {
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
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
                      children: [
                        {
                          apiVersion: 'loykin.dev/v1alpha1',
                          kind: 'DataBodyGroup',
                          spec: {
                            title: 'Profile',
                            description: 'The member receives an invite email.',
                            layout: 'stacked',
                            variant: 'plain',
                          },
                          slots: [
                            {
                              children: [
                                {
                                  apiVersion: 'loykin.dev/v1alpha1',
                                  kind: 'DataBodyRow',
                                  spec: { label: 'Name', required: true },
                                  slots: [
                                    {
                                      children: [
                                        {
                                          apiVersion: 'loykin.dev/v1alpha1',
                                          kind: 'InputControl',
                                          spec: { name: 'name', placeholder: 'Full name' },
                                        },
                                      ],
                                    },
                                  ],
                                },
                                {
                                  apiVersion: 'loykin.dev/v1alpha1',
                                  kind: 'DataBodyRow',
                                  spec: { label: 'Email', required: true },
                                  slots: [
                                    {
                                      children: [
                                        {
                                          apiVersion: 'loykin.dev/v1alpha1',
                                          kind: 'InputControl',
                                          spec: { name: 'email', type: 'email', placeholder: 'name@acme.com' },
                                        },
                                      ],
                                    },
                                  ],
                                },
                                {
                                  apiVersion: 'loykin.dev/v1alpha1',
                                  kind: 'DataBodyRow',
                                  spec: { label: 'Role' },
                                  slots: [
                                    {
                                      children: [
                                        {
                                          apiVersion: 'loykin.dev/v1alpha1',
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

const userEditor: LoykinResource = {
  apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Edit user', eyebrow: 'record scope → form → mutation → refetch' },
          slots: [
            {
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
                  kind: 'RecordScope',
                  spec: {
                    data: { source: 'memory', collection: 'users', id: '${userId}', v: '${usersVersion}' },
                  },
                  slots: [
                    {
                      children: [
                        {
                          apiVersion: 'loykin.dev/v1alpha1',
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
                              children: [
                                {
                                  apiVersion: 'loykin.dev/v1alpha1',
                                  kind: 'DataBodyGroup',
                                  spec: { title: 'Profile', layout: 'stacked', variant: 'plain' },
                                  slots: [
                                    {
                                      children: [
                                        {
                                          apiVersion: 'loykin.dev/v1alpha1',
                                          kind: 'DataBodyRow',
                                          spec: { label: 'Name', required: true },
                                          slots: [
                                            {
                                              children: [
                                                {
                                                  apiVersion: 'loykin.dev/v1alpha1',
                                                  kind: 'InputControl',
                                                  spec: { name: 'name', fieldRef: 'name', placeholder: 'Full name' },
                                                },
                                              ],
                                            },
                                          ],
                                        },
                                        {
                                          apiVersion: 'loykin.dev/v1alpha1',
                                          kind: 'DataBodyRow',
                                          spec: { label: 'Email', required: true },
                                          slots: [
                                            {
                                              children: [
                                                {
                                                  apiVersion: 'loykin.dev/v1alpha1',
                                                  kind: 'InputControl',
                                                  spec: { name: 'email', type: 'email', fieldRef: 'email', placeholder: 'user@acme.com' },
                                                },
                                              ],
                                            },
                                          ],
                                        },
                                        {
                                          apiVersion: 'loykin.dev/v1alpha1',
                                          kind: 'DataBodyRow',
                                          spec: { label: 'Role' },
                                          slots: [
                                            {
                                              children: [
                                                {
                                                  apiVersion: 'loykin.dev/v1alpha1',
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
      children: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'No user selected' },
          slots: [
            {
              children: [
                {
                  apiVersion: 'loykin.dev/v1alpha1',
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

const examples = [
  ...scenarioExamples,
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
registry.use({
  name: 'playground-resolvers',
  dataResolvers: { datasource: playgroundDatasourceResolver, rest: restResolver, static: staticResolver, memory: memoryDataResolver },
  mutationResolvers: { memory: memoryMutationResolver },
})
registry.use(createPlaygroundResourceAdapters())

const playgroundScope = registry.scope({
  apiVersions: ['loykin.dev/v1alpha1'],
  kinds: {
    include: registry.listKinds().map((manifest) => manifest.kind),
  },
  maxDepth: 8,
})

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectVariables(resource: LoykinResource): unknown[] {
  return isRecord(resource.spec) && Array.isArray(resource.spec.variables) ? resource.spec.variables : []
}

function collectEvents(resource: LoykinResource, path = resource.kind): Array<{ path: string; events: unknown }> {
  const events: Array<{ path: string; events: unknown }> =
    isRecord(resource.spec) && isRecord(resource.spec.events) ? [{ path, events: resource.spec.events }] : []
  for (const slot of resource.slots ?? []) {
    slot.children.forEach((child, index) => {
      events.push(...collectEvents(child, `${path}/slots/${slot.name ?? 'default'}/${index}:${child.kind}`))
    })
  }
  return events
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

  const [selectedExampleId, setSelectedExampleId] = useState<(typeof examples)[number]['id']>(() => initialExample().id)
  const [resource, setResource] = useState<LoykinResource>(() => initialExample().resource)
  const [loadError, setLoadError] = useState<string>()
  const [jsonSheetOpen, setJsonSheetOpen] = useState(false)
  const [aiRequestSheetOpen, setAiRequestSheetOpen] = useState(false)
  const [toast, setToast] = useState<string>()

  // External hook: documents emit events; the app decides what they mean.
  const handleDocumentEvent = (event: string, payload?: unknown) => {
    if (event === 'users.created') {
      const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
      setToast(`${String(record.name ?? 'Member')} added to the team`)
      window.setTimeout(() => setToast(undefined), 3500)
    }
  }

  const selectedExample = examples.find((example) => example.id === selectedExampleId) ?? examples[0]
  const validation = useMemo(() => validateResource(resource, playgroundScope), [resource])
  const schema = useMemo(() => buildDocumentSchema(playgroundScope), [])
  const variablesAndEvents = useMemo(
    () => ({
      variables: collectVariables(resource),
      events: collectEvents(resource),
    }),
    [resource],
  )
  const resourceJson = useMemo(() => prettyJson(resource), [resource])
  const aiRequest = useMemo(
    () =>
      prettyJson({
        task: 'Render this Loykin resource document in a host app using @loykin/resourcekit.',
        selectedExample: {
          id: selectedExample.id,
          name: selectedExample.name,
          description: selectedExample.description,
        },
        instructions: [
          'Use only kinds and fields allowed by scopedSchema.',
          'Return a JSON resource document that follows the same envelope shape.',
          'Use variables/events for local interaction state instead of imperative UI code.',
        ],
        resource,
        scopedSchema: schema,
        validation,
        variablesAndEvents,
      }),
    [resource, schema, selectedExample.description, selectedExample.id, selectedExample.name, validation, variablesAndEvents],
  )

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
                    <SidebarMenuButton isActive type="button">
                      <LayoutDashboard />
                      <span>Resource runtime</span>
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
                <section className="rk-render-pane">
                  <div className="rk-render-toolbar">
                    <ExampleSelect value={selectedExampleId} onValueChange={selectExampleById} />
                    <div className="rk-pane-actions">
                      <Button size="sm" variant="outline" onClick={() => setAiRequestSheetOpen(true)}>
                        <Sparkles />
                        AI request
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setJsonSheetOpen(true)}>
                        <Braces />
                        Show JSON
                      </Button>
                    </div>
                  </div>
                  <div className="rk-render-body">{renderOutput}</div>
                </section>
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
                <Sheet open={aiRequestSheetOpen} onOpenChange={setAiRequestSheetOpen}>
                  <SheetContent side="right" className="rk-json-sheet-content">
                    <SheetHeader className="rk-json-sheet-header">
                      <div>
                        <SheetTitle className="rk-json-sheet-title">AI request</SheetTitle>
                        <p className="rk-json-sheet-description">Prompt payload for generating or modifying a resource document.</p>
                      </div>
                    </SheetHeader>
                    <div className="rk-editor-shell">
                      <JsonEditor value={aiRequest} readOnly />
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
