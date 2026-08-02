import type { Resource } from '@loykin/resourcekit'

const apiVersion = 'resourcekit.dev/v1alpha1'
const staticRows = (rows: Array<Record<string, unknown>>) => ({
  apiVersion,
  kind: 'static',
  spec: { rows },
})

const members = [
  { id: '1', name: 'Sarah Kim', email: 'sarah@acme.com', role: 'Admin', status: 'Active' },
  { id: '2', name: 'Marcus Lee', email: 'marcus@acme.com', role: 'Editor', status: 'Active' },
  { id: '3', name: 'Ji-Yeon Park', email: 'jiyeon@acme.com', role: 'Viewer', status: 'Pending' },
]

const articles = [
  { id: 'design-systems', slug: 'design-systems', title: 'Design systems that scale', category: 'Engineering', excerpt: 'A practical contract for reusable product interfaces.', publishedAt: 'Aug 2, 2026' },
  { id: 'query-boundaries', slug: 'query-boundaries', title: 'Queries belong to destinations', category: 'Architecture', excerpt: 'Keep route loading independent and preserve existing content during refresh.', publishedAt: 'Jul 28, 2026' },
]

const products = [
  { id: 'desk-lamp', slug: 'desk-lamp', name: 'Arc desk lamp', category: 'Lighting', price: '$129', status: 'In stock', description: 'Focused task lighting with a warm, dimmable beam.' },
  { id: 'side-chair', slug: 'side-chair', name: 'Oak side chair', category: 'Furniture', price: '$249', status: 'In stock', description: 'Solid oak seating designed for compact dining spaces.' },
  { id: 'wool-throw', slug: 'wool-throw', name: 'Wool throw', category: 'Textiles', price: '$89', status: 'Low stock', description: 'A soft merino layer for sofas and reading chairs.' },
]

const breadcrumb = (items: Array<string | { label: string; href?: string }>): Resource => ({
  apiVersion,
  kind: 'PageTopBar',
  spec: {},
  slots: [{ name: 'left', items: [{ apiVersion, kind: 'PageBreadcrumb', spec: { items } }] }],
})

const managedTable: Resource = {
  apiVersion,
  kind: 'DataBody',
  metadata: { name: 'guide-managed-table' },
  spec: { title: 'Members', description: 'Manage workspace access and account status.', defaultTab: 'members' },
  variables: [
    { name: 'memberStatus', type: 'string', default: 'all' },
    { name: 'selectedMember', type: 'string' },
  ],
  objectState: [{ name: 'memberTable', initialValue: { pageIndex: 0 } }],
  slots: [
    { name: 'topBar', items: [breadcrumb(['Resources', 'Members'])] },
    {
      items: [
        {
          apiVersion,
          kind: 'DataBodyTab',
          spec: { id: 'members', label: 'Members', count: members.length },
          slots: [
            {
              items: [
                {
                  apiVersion,
                  kind: 'DataBodyResource',
                  spec: {},
                  slots: [
                    {
                      name: 'toolbarLeft',
                      items: [
                        { apiVersion, kind: 'InputControl', spec: { name: 'search', placeholder: 'Search members…' } },
                        {
                          apiVersion,
                          kind: 'FilterControl',
                          bindings: { value: { $variable: 'memberStatus' } },
                          spec: {
                            config: {
                              key: 'status',
                              type: 'select',
                              label: 'Status',
                              options: [
                                { label: 'All', value: 'all' },
                                { label: 'Active', value: 'active' },
                                { label: 'Pending', value: 'pending' },
                              ],
                            },
                          },
                          events: { change: { kind: 'setVariable', variable: 'memberStatus', from: 'value' } },
                        },
                      ],
                    },
                    {
                      name: 'toolbarRight',
                      items: [
                        {
                          apiVersion,
                          kind: 'ActionButton',
                          spec: { label: 'Add member', size: 'sm' },
                          events: { click: { kind: 'action', action: 'members.create' } },
                        },
                      ],
                    },
                    {
                      items: [
                        {
                          apiVersion,
                          kind: 'TableView',
                          bindings: { pageIndex: { $state: 'memberTable', path: 'pageIndex' } },
                          spec: {
                            data: staticRows(members),
                            columns: {
                              name: { label: 'Name', emphasis: 'strong' },
                              email: { label: 'Email', tone: 'muted' },
                              role: { label: 'Role' },
                              status: { label: 'Status', display: 'badge' },
                            },
                            enableSorting: true,
                            initialSorting: [{ id: 'name', desc: false }],
                            pagination: { pageSize: 10, pageCount: 1, totalCount: members.length, pageSizes: [10] },
                          },
                          events: { rowSelect: { kind: 'setVariable', variable: 'selectedMember', from: 'row.id' } },
                        },
                      ],
                    },
                  ],
                },
                {
                  apiVersion,
                  kind: 'Sheet',
                  bindings: { open: { $variable: 'selectedMember' } },
                  spec: { title: 'Member details', side: 'right', width: 420 },
                  slots: [{ items: [{ apiVersion, kind: 'Text', spec: { text: 'Concise read-only member information stays beside the mounted table.' } }] }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

const stackedForm: Resource = {
  apiVersion,
  kind: 'DataBody',
  metadata: { name: 'guide-form-workflow' },
  spec: { title: 'Add member', description: 'Create a workspace member.' },
  slots: [
    { name: 'topBar', items: [breadcrumb(['Resources', { label: 'Members', href: '/members' }, 'Add member'])] },
    {
      items: [
        {
          apiVersion,
          kind: 'ResourceForm',
          spec: {
            cancelLabel: 'Cancel',
            submitLabel: 'Save member',
            successMessage: 'Member saved',
            submit: { mutation: { apiVersion, kind: 'memory', spec: { collection: 'members' } } },
          },
          events: { cancel: { kind: 'action', action: 'members.cancelCreate' } },
          slots: [
            {
              items: [
                {
                  apiVersion,
                  kind: 'DataBodyGroup',
                  spec: { layout: 'stacked', title: 'Identity', description: 'Basic account information.' },
                  slots: [
                    {
                      items: [
                        { apiVersion, kind: 'DataBodyRow', spec: { label: 'Name', required: true }, slots: [{ items: [{ apiVersion, kind: 'InputControl', spec: { name: 'name', required: true, requiredMessage: 'Enter a member name.' } }] }] },
                        { apiVersion, kind: 'DataBodyRow', spec: { label: 'Email', required: true }, slots: [{ items: [{ apiVersion, kind: 'InputControl', spec: { name: 'email', type: 'email', required: true, requiredMessage: 'Enter an email address.' } }] }] },
                      ],
                    },
                  ],
                },
                {
                  apiVersion,
                  kind: 'DataBodyGroup',
                  spec: { layout: 'stacked', title: 'Role & access', description: 'Default workspace permissions.' },
                  slots: [
                    {
                      items: [
                        { apiVersion, kind: 'DataBodyRow', spec: { label: 'Role' }, slots: [{ items: [{ apiVersion, kind: 'Select', spec: { name: 'role', value: 'viewer', options: [{ label: 'Admin', value: 'admin' }, { label: 'Viewer', value: 'viewer' }] } }] }] },
                        { apiVersion, kind: 'DataBodyRow', spec: { label: 'Active' }, slots: [{ items: [{ apiVersion, kind: 'Switch', spec: { name: 'active', label: 'Member can sign in', defaultChecked: true } }] }] },
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

const publishingCollection: Resource = {
  apiVersion,
  kind: 'DataBody',
  metadata: { name: 'guide-publishing-collection' },
  spec: { title: 'Journal', description: 'Ideas and field notes from the team.' },
  slots: [
    { name: 'topBar', items: [breadcrumb(['Journal'])] },
    {
      items: [
        {
          apiVersion,
          kind: 'DataBodyResource',
          spec: {},
          slots: [
            { name: 'toolbarLeft', items: [{ apiVersion, kind: 'InputControl', spec: { name: 'search', placeholder: 'Search articles…' } }] },
            {
              items: [
                {
                  apiVersion,
                  kind: 'CardCollection',
                  spec: { data: staticRows(articles), idField: 'slug', titleField: 'title', subtitleField: 'publishedAt', descriptionField: 'excerpt', statusField: 'category', minCardWidth: 280 },
                  events: { rowSelect: { kind: 'action', action: 'publishing.openArticle' } },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

const publishingArticle: Resource = {
  apiVersion,
  kind: 'DetailBody',
  metadata: { name: 'guide-publishing-article' },
  spec: { variant: 'full', eyebrow: 'Engineering', title: 'Design systems that scale', description: 'Published Aug 2, 2026' },
  slots: [
    { name: 'topBar', items: [breadcrumb([{ label: 'Journal', href: '/journal' }, 'Design systems that scale'])] },
    { name: 'actions', items: [{ apiVersion, kind: 'ActionButton', spec: { label: 'Share', variant: 'outline', size: 'sm' }, events: { click: { kind: 'action', action: 'publishing.shareArticle' } } }] },
    { items: [{ apiVersion, kind: 'DetailBodySection', spec: { title: 'A stable implementation contract', surface: 'plain' }, slots: [{ items: [{ apiVersion, kind: 'Text', spec: { text: 'A route owns its query, loading behavior, actions, and one page-level template. Browser history connects the collection and article destinations.' } }] }] }] },
  ],
}

const commerceCatalog: Resource = {
  apiVersion,
  kind: 'Browse',
  metadata: { name: 'guide-commerce-catalog' },
  spec: { title: 'Catalog', description: 'Objects selected for useful, lasting spaces.', sidebarTitle: 'Filter products', sidebarWidth: '16rem' },
  variables: [{ name: 'category', type: 'string', default: 'all' }],
  slots: [
    { name: 'topBar', items: [breadcrumb(['Shop', 'Catalog'])] },
    {
      name: 'sidebar',
      items: [
        {
          apiVersion,
          kind: 'FilterControl',
          bindings: { value: { $variable: 'category' } },
          spec: { config: { key: 'category', type: 'select', label: 'Category', options: [{ label: 'All', value: 'all' }, { label: 'Lighting', value: 'lighting' }, { label: 'Furniture', value: 'furniture' }] } },
          events: { change: { kind: 'setVariable', variable: 'category', from: 'value' } },
        },
      ],
    },
    { name: 'toolbar', items: [{ apiVersion, kind: 'Text', spec: { text: `${products.length} products · Featured first` } }] },
    {
      items: [
        {
          apiVersion,
          kind: 'CardCollection',
          spec: { data: staticRows(products), idField: 'slug', titleField: 'name', subtitleField: 'price', descriptionField: 'description', statusField: 'status', minCardWidth: 240, minColumns: 1 },
          events: { rowSelect: { kind: 'action', action: 'commerce.openProduct' } },
        },
      ],
    },
  ],
}

const commerceProduct: Resource = {
  apiVersion,
  kind: 'DetailBody',
  metadata: { name: 'guide-commerce-product' },
  spec: { variant: 'media', eyebrow: 'Lighting', title: 'Arc desk lamp', description: '$129', status: 'In stock', stickyAside: true },
  slots: [
    { name: 'topBar', items: [breadcrumb([{ label: 'Catalog', href: '/products' }, 'Arc desk lamp'])] },
    { name: 'media', items: [{ apiVersion, kind: 'Panel', spec: { title: 'Product media' }, slots: [{ items: [{ apiVersion, kind: 'Text', spec: { text: 'Primary product imagery belongs in this decision-focused media region.' } }] }] }] },
    { name: 'aside', items: [{ apiVersion, kind: 'Panel', spec: { title: 'Purchase' }, slots: [{ items: [{ apiVersion, kind: 'Text', spec: { text: 'Warm dimmable LED · ships in 2–3 days' } }] }, { name: 'actions', items: [{ apiVersion, kind: 'ActionButton', spec: { label: 'Add to cart' }, events: { click: { kind: 'action', action: 'commerce.addToCart' } } }] }] }] },
    { items: [{ apiVersion, kind: 'DetailBodySection', spec: { title: 'Details', surface: 'plain' }, slots: [{ items: [{ apiVersion, kind: 'Text', spec: { text: 'Focused task lighting with an adjustable arm and a warm, dimmable beam.' } }] }] }] },
  ],
}

export const designkitGuideExamples = [
  { id: 'guide-managed-table', name: 'Guide / Administrative CRUD', description: 'Managed table resource boundary, linked create action, controlled pagination, and concise detail Sheet.', category: 'designkit-guide', resource: managedTable },
  { id: 'guide-form-workflow', name: 'Guide / Forms / Stacked Form', description: 'Canonical route-level stacked form with modular groups, controlled controls, validation, and bottom actions.', category: 'designkit-guide', resource: stackedForm },
  { id: 'guide-publishing-collection', name: 'Guide / Publishing / Collection', description: 'Searchable publishing collection whose card action is handed to host navigation.', category: 'designkit-guide', resource: publishingCollection },
  { id: 'guide-publishing-article', name: 'Guide / Publishing / Article', description: 'Independent, linkable article destination rendered with DetailBody.', category: 'designkit-guide', resource: publishingArticle },
  { id: 'guide-commerce-catalog', name: 'Guide / Commerce / Catalog', description: 'Faceted Browse catalog with a declarative GridKit card collection.', category: 'designkit-guide', resource: commerceCatalog },
  { id: 'guide-commerce-product', name: 'Guide / Commerce / Product', description: 'Independent product decision route with media, purchase aside, and route-local action.', category: 'designkit-guide', resource: commerceProduct },
] as const
