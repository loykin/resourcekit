// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../../registry'
import { ResourceRenderer } from '../../react'
import type { KindRenderFn } from '../../react'
import { createDesignKitPlugin } from './plugin'

afterEach(cleanup)

describe('DesignKit forms', () => {
  it('preserves repeated FormData names as an array', async () => {
    const mutation = vi.fn(async (_binding, payload) => payload)
    const registry = createRegistry<KindRenderFn>()
    registry.use(createDesignKitPlugin())
    registry.use({ name: 'runtime', mutationResolvers: { memory: mutation } })

    // Two fields sharing `name: 'roles'` used to also share the same React
    // key (`key={field.name}`), which React flags as a duplicate-key error
    // during reconciliation — assert it doesn't fire alongside the FormData
    // behavior below.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'FormView',
          spec: {
            sections: [
              {
                id: 'roles',
                fields: [
                  { name: 'roles', label: 'Admin', type: 'checkbox', defaultValue: 'admin' },
                  { name: 'roles', label: 'Editor', type: 'checkbox', defaultValue: 'editor' },
                ],
              },
            ],
            submitLabel: 'Save roles',
            submit: { mutation: { target: 'memory' } },
          },
        },
      }),
    )

    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Save roles' }))

    await waitFor(() => expect(mutation).toHaveBeenCalled())
    expect(mutation.mock.calls[0][1]).toEqual({ roles: ['admin', 'editor'] })
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('two children with the same key'), expect.anything())
    consoleError.mockRestore()
  })
})
