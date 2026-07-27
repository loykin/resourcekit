// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../../core/registry'
import { ResourceRenderer } from '../../react'
import type { KindRenderFn } from '../../react'
import { createRJSFPlugin } from './plugin'

afterEach(cleanup)

describe('createRJSFPlugin', () => {
  it('registers JSONSchemaForm as hostAuthoredOnly — dropped from an AI-facing scope even when kinds.include names it', () => {
    const registry = createRegistry<KindRenderFn>()
    registry.use(createRJSFPlugin())

    expect(registry.getKind('resourcekit.dev/v1alpha1', 'JSONSchemaForm')).toBeDefined()

    const scoped = registry.scope({ kinds: { include: ['JSONSchemaForm'] } })
    expect(scoped.getKind('resourcekit.dev/v1alpha1', 'JSONSchemaForm')).toBeUndefined()
    expect(scoped.listKinds()).toEqual([])
  })

  it('blocks submission on a customValidate cross-field mismatch, then succeeds once fixed', async () => {
    const mutation = vi.fn(async (_binding, payload) => payload)
    const registry = createRegistry<KindRenderFn>()
    registry.use(createRJSFPlugin({
      passwordsMatch: (formData, errors) => {
        const data = formData as { password?: string; confirmPassword?: string }
        if (data.password !== data.confirmPassword) {
          errors.confirmPassword?.addError('Passwords must match')
        }
        return errors
      },
    }))
    registry.use({
      name: 'runtime',
      mutationSourceManifests: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'memory', resolve: mutation }],
    })

    render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'JSONSchemaForm',
          spec: {
            jsonSchema: {
              type: 'object',
              required: ['password', 'confirmPassword'],
              properties: {
                password: { type: 'string', title: 'Password' },
                confirmPassword: { type: 'string', title: 'Confirm password' },
              },
            },
            submit: { mutation: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'memory', spec: {} } },
            customValidateKey: 'passwordsMatch',
          },
        },
      }),
    )

    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'secret1' } })
    fireEvent.change(screen.getByLabelText(/^Confirm password/), { target: { value: 'secret2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByText('Passwords must match')).toBeTruthy())
    expect(mutation).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/^Confirm password/), { target: { value: 'secret1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mutation).toHaveBeenCalled())
    expect(mutation).toHaveBeenCalledWith(
      { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'memory', spec: {} },
      { password: 'secret1', confirmPassword: 'secret1' },
      expect.anything(),
    )
  })

  it('submits a dynamic array-of-objects field as a real nested structure, no hidden-JSON serialization', async () => {
    const mutation = vi.fn(async (_binding, payload) => payload)
    const registry = createRegistry<KindRenderFn>()
    registry.use(createRJSFPlugin())
    registry.use({
      name: 'runtime',
      mutationSourceManifests: [{ apiVersion: 'resourcekit.dev/v1alpha1', kind: 'memory', resolve: mutation }],
    })

    const { container } = render(
      createElement(ResourceRenderer, {
        registry,
        resource: {
          apiVersion: 'resourcekit.dev/v1alpha1',
          kind: 'JSONSchemaForm',
          spec: {
            jsonSchema: {
              type: 'object',
              properties: {
                hooks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', title: 'Name' },
                    },
                  },
                },
              },
            },
            submit: { mutation: { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'memory', spec: {} } },
          },
        },
      }),
    )

    const addButton = container.querySelector('.btn-add') as HTMLElement
    expect(addButton).toBeTruthy()
    fireEvent.click(addButton)

    await waitFor(() => expect(screen.getByLabelText(/^Name/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'warmup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mutation).toHaveBeenCalled())
    expect(mutation).toHaveBeenCalledWith(
      { apiVersion: 'resourcekit.dev/v1alpha1', kind: 'memory', spec: {} },
      { hooks: [{ name: 'warmup' }] },
      expect.anything(),
    )
  })
})
