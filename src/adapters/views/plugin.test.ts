// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRegistry } from '../../core/registry'
import { staticResolver } from '../../connection/resolvers'
import { ResourceRenderer } from '../../react'
import type { KindRenderFn } from '../../react'
import { createResourceViewPlugin } from './plugin'

afterEach(cleanup)

describe('DetailView', () => {
  it('renders a card summary with mapped title, subtitle, and status fields', async () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createResourceViewPlugin())
    registry.use({ name: 'static-data', dataResolvers: { static: staticResolver } })

    const { container } = render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'DetailView',
          spec: {
            data: {
              source: 'static',
              rows: [{ name: 'Sarah Kim', email: 'sarah@acme.com', role: 'Admin', status: 'active' }],
            },
            layout: 'cards',
            titleField: 'name',
            subtitleField: 'email',
            statusField: 'status',
            fields: [{ field: 'role', label: 'Role' }],
          },
        },
      }),
    )

    expect(await screen.findByRole('heading', { name: 'Sarah Kim' })).toBeTruthy()
    expect(screen.getByText('sarah@acme.com')).toBeTruthy()
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByText('Admin')).toBeTruthy()
    expect(container.querySelector('dl > div')?.className).toContain('border-border')
  })
})
