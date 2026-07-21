import type { Resource } from '@loykin/resourcekit'

const userRows = [
  { id: '1', name: 'Sarah Kim', email: 'sarah@acme.com', role: 'Admin', status: 'Active', joined: '2024-01-12' },
  { id: '2', name: 'Marcus Lee', email: 'marcus@acme.com', role: 'Editor', status: 'Active', joined: '2024-02-03' },
  { id: '3', name: 'Ji-Yeon Park', email: 'jiyeon@acme.com', role: 'Viewer', status: 'Inactive', joined: '2024-03-18' },
  { id: '4', name: 'Alex Chen', email: 'alex@acme.com', role: 'Editor', status: 'Pending', joined: '2024-04-07' },
]

const dataBodyDetail: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'DataBody',
  metadata: { name: 'designkit-databody-detail-parity' },
  spec: { title: 'Sarah Kim', description: 'sarah@acme.com' },
  slots: [
    {
      name: 'topBar',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'PageTopBar',
          spec: { left: 'Users / Sarah Kim' },
        },
      ],
    },
    {
      name: 'actions',
      items: [
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'ActionButton', spec: { label: 'Delete', variant: 'outline', size: 'sm' } },
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'ActionButton', spec: { label: 'Edit', size: 'sm' } },
      ],
    },
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DataBodyGroup',
          spec: { title: 'Identity', layout: 'inline' },
          slots: [
            {
              items: [
                { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'DataBodyField', spec: { label: 'Full name', value: 'Sarah Kim' } },
                { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'DataBodyField', spec: { label: 'Email', value: 'sarah@acme.com' } },
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DataBodyField',
                  spec: { label: 'Role' },
                  slots: [
                    {
                      items: [
                        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Badge', spec: { label: 'Admin', variant: 'outline' } },
                      ],
                    },
                  ],
                },
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DataBodyField',
                  spec: { label: 'Status' },
                  slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Badge', spec: { label: 'Active' } }] }],
                },
                { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'DataBodyField', spec: { label: 'Joined', value: 'Jan 12, 2024' } },
              ],
            },
          ],
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DataBodyGroup',
          spec: { title: 'Account', layout: 'inline' },
          slots: [
            {
              items: [
                { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'DataBodyField', spec: { label: 'Plan', value: 'Business' } },
                { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'DataBodyField', spec: { label: 'Seats used', value: '12 / 20' } },
                { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'DataBodyField', spec: { label: 'Billing cycle', value: 'Monthly' } },
                { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'DataBodyField', spec: { label: 'Next renewal', value: 'Jun 1, 2025' } },
              ],
            },
          ],
        },
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DataBodyGroup',
          spec: { title: 'Danger zone', layout: 'inline', danger: true },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DataBodyField',
                  spec: { label: 'Deactivate account' },
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'ActionButton',
                          spec: { label: 'Deactivate', variant: 'ghost', size: 'sm' },
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

const dataBodySplit: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'DataBody',
  metadata: { name: 'designkit-databody-split-parity' },
  spec: {
    title: 'Users',
    variables: [{ name: 'userId', type: 'string', default: '1' }],
  },
  slots: [
    {
      name: 'topBar',
      items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'PageTopBar', spec: { left: 'Users' } }],
    },
    {
      name: 'actions',
      items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'ActionButton', spec: { label: 'Add User', size: 'sm' } }],
    },
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DataBodyGroup',
          spec: { layout: 'split' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'SelectableList',
                  bindings: { selected: { $variable: 'userId' } },
                  spec: {
                    data: { source: 'static', rows: userRows },
                    idField: 'id',
                    primary: { field: 'name' },
                    secondary: [{ field: 'email' }],
                    events: { select: { kind: 'setVariable', variable: 'userId', from: 'row.id' } },
                  },
                },
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'DetailView',
                  spec: {
                    data: { source: 'memory', collection: 'users', id: '${userId}' },
                    layout: 'cards',
                    titleField: 'name',
                    subtitleField: 'email',
                    statusField: 'status',
                    fields: [
                      { field: 'role', label: 'Role' },
                      { field: 'status', label: 'Status' },
                    ],
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

const workbenchSqlEditor: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'Workbench',
  metadata: { name: 'designkit-workbench-sql-parity' },
  spec: {
    title: 'Query editor',
    description: 'Workbench shell parity; the editor body remains a placeholder until an editor adapter exists.',
    leftPaneWidth: 240,
    bottomPaneHeight: 240,
    resizable: true,
  },
  slots: [
    {
      name: 'topBar',
      items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'PageTopBar', spec: { left: 'Data / Query editor', variant: 'default' } }],
    },
    {
      name: 'status',
      items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Badge', spec: { label: 'Connected' } }],
    },
    {
      name: 'headerRight',
      items: [
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'ActionButton', spec: { label: 'Explain', variant: 'outline', size: 'sm' } },
        { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'ActionButton', spec: { label: 'Run', size: 'sm' } },
      ],
    },
    {
      name: 'leftPane',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Schema' },
          slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', spec: { text: 'public.users\npublic.accounts\npublic.sessions' } }] }],
        },
      ],
    },
    {
      name: 'mainPane',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'Panel',
          spec: { title: 'Query' },
          slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Text', spec: { text: 'SELECT * FROM users ORDER BY joined DESC;' } }] }],
        },
      ],
    },
    {
      name: 'bottomPane',
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'TableView',
          spec: {
            data: { source: 'static', rows: userRows },
            columns: {
              name: { label: 'Name', emphasis: 'strong' },
              email: { label: 'Email' },
              role: { label: 'Role' },
              status: { label: 'Status', display: 'badge' },
            },
            tableHeight: '100%',
          },
        },
      ],
    },
  ],
}

const fieldKindsForm: Resource = {
  apiVersion: 'resourcekit.dev/v1alpha1',
  kind: 'RecordScope',
  metadata: { name: 'designkit-field-kinds-parity' },
  spec: { data: { source: 'static', rows: [{ bio: 'Loves cron jobs.\nHates flaky tests.', roles: ['admin', 'viewer'], concurrencyPolicy: 'Forbid' }] } },
  slots: [
    {
      items: [
        {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DataBody',
          spec: { title: 'Field kinds parity', description: 'required/disabled parity, Textarea, Checkbox, Select' },
          slots: [
            {
              items: [
                {
                  apiVersion: 'resourcekit.dev/v1alpha1',
                  kind: 'ResourceForm',
                  spec: {
                    id: 'field-kinds-form',
                    submit: { mutation: { target: 'memory', collection: 'settings' } },
                    successMessage: 'Saved in memory',
                  },
                  slots: [
                    {
                      items: [
                        {
                          apiVersion: 'resourcekit.dev/v1alpha1',
                          kind: 'DataBodyGroup',
                          spec: { title: 'Profile' },
                          slots: [
                            {
                              items: [
                                {
                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                  kind: 'DataBodyRow',
                                  spec: { label: 'Username', required: true },
                                  slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'InputControl', spec: { name: 'username', required: true } }] }],
                                },
                                {
                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                  kind: 'DataBodyRow',
                                  spec: { label: 'Username (locked)' },
                                  slots: [
                                    { items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'InputControl', spec: { name: 'lockedUsername', value: 'skim', disabled: true } }] },
                                  ],
                                },
                                {
                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                  kind: 'DataBodyRow',
                                  spec: { label: 'Bio' },
                                  slots: [{ items: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'Textarea', spec: { name: 'bio', fieldRef: 'bio', rows: 3 } }] }],
                                },
                                {
                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                  kind: 'DataBodyRow',
                                  spec: { label: 'Concurrency policy' },
                                  slots: [
                                    {
                                      items: [
                                        {
                                          apiVersion: 'resourcekit.dev/v1alpha1',
                                          kind: 'Select',
                                          spec: {
                                            name: 'concurrencyPolicy',
                                            fieldRef: 'concurrencyPolicy',
                                            options: [
                                              { label: 'Allow', value: 'Allow' },
                                              { label: 'Forbid', value: 'Forbid' },
                                              { label: 'Replace', value: 'Replace' },
                                            ],
                                          },
                                        },
                                      ],
                                    },
                                  ],
                                },
                                {
                                  apiVersion: 'resourcekit.dev/v1alpha1',
                                  kind: 'DataBodyRow',
                                  spec: { label: 'Roles' },
                                  slots: [
                                    {
                                      items: [
                                        {
                                          apiVersion: 'resourcekit.dev/v1alpha1',
                                          kind: 'Checkbox',
                                          spec: { name: 'roles', label: 'Admin', value: 'admin', fieldRef: 'roles' },
                                        },
                                        {
                                          apiVersion: 'resourcekit.dev/v1alpha1',
                                          kind: 'Checkbox',
                                          spec: { name: 'roles', label: 'Editor', value: 'editor', fieldRef: 'roles' },
                                        },
                                        {
                                          apiVersion: 'resourcekit.dev/v1alpha1',
                                          kind: 'Checkbox',
                                          spec: { name: 'roles', label: 'Viewer', value: 'viewer', fieldRef: 'roles' },
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

export const designkitParityExamples = [
  {
    id: 'parity-designkit-field-kinds',
    name: 'Parity / Field kinds (Textarea, Checkbox, Select)',
    description: 'required/disabled parity, and the new Textarea/Checkbox/Select kinds, submitting through ResourceForm.',
    category: 'designkit-parity',
    resource: fieldKindsForm,
  },
  {
    id: 'parity-designkit-databody-detail',
    name: 'Parity / DataBody detail',
    description: 'Resource document counterpart of DesignKit databody-detail.',
    category: 'designkit-parity',
    resource: dataBodyDetail,
  },
  {
    id: 'parity-designkit-databody-split',
    name: 'Parity / DataBody split',
    description: 'Resource document counterpart of DesignKit databody-split with live selection.',
    category: 'designkit-parity',
    resource: dataBodySplit,
  },
  {
    id: 'parity-designkit-workbench-sql',
    name: 'Parity / Workbench SQL editor',
    description: 'Structural counterpart of DesignKit workbench-sql-editor; exposes the missing editor adapter visually.',
    category: 'designkit-parity',
    resource: workbenchSqlEditor,
  },
] as const
