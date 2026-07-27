import { useState } from 'react'
import Form from '@rjsf/core'
import validator from '@rjsf/validator-ajv8'
import type { RJSFSchema, UiSchema, CustomValidator } from '@rjsf/utils'
import type { Resource, ResourceKitPlugin, SubmitSpec } from '../../core/types'
import type { KindRenderFn, RenderContext } from '../../react'

const API_VERSION = 'resourcekit.dev/v1alpha1'

export interface JSONSchemaFormSpec {
  jsonSchema: RJSFSchema
  uiSchema?: UiSchema
  submit: SubmitSpec
  submitLabel?: string
  /**
   * Names a validator the host supplied to `createRJSFPlugin` — `customValidate`
   * itself is a JS function, not JSON, so it can't live inside a spec that's
   * meant to stay AI-safe/serializable. Same by-name-reference pattern
   * resourcekit already uses for `DataBinding`/`MutationBinding` kinds: the
   * document picks a name, the host registers the actual implementation.
   */
  customValidateKey?: string
}

function JSONSchemaFormNode({
  spec,
  ctx,
  customValidators,
}: {
  spec: JSONSchemaFormSpec
  ctx: RenderContext
  customValidators: Record<string, CustomValidator>
}) {
  const [formData, setFormData] = useState<unknown>(undefined)
  const customValidate = spec.customValidateKey ? customValidators[spec.customValidateKey] : undefined
  return (
    <Form
      schema={spec.jsonSchema}
      uiSchema={spec.uiSchema}
      formData={formData}
      validator={validator}
      customValidate={customValidate}
      onChange={(e) => setFormData(e.formData as unknown)}
      onSubmit={({ formData: submitted }) => {
        void ctx.actions.submit(spec.submit, submitted)
      }}
    >
      <button type="submit">{spec.submitLabel ?? 'Save'}</button>
    </Form>
  )
}

/**
 * Bridges `react-jsonschema-form` in as an ordinary `ResourceKitPlugin` —
 * same shape as the designkit/gridkit adapters (a plugin registering one
 * kind), no resourcekit core changes needed. Closes the two gaps a plain
 * designkit-composed form can't (docs/provisr-poc-findings.md #6, #9):
 * cross-field validation and native array-of-objects fields — RJSF's own
 * `formData` is a real structured JS value from the start, so a repeating
 * group submits as a genuine nested array, never a hidden-JSON string.
 *
 * `JSONSchemaForm`'s own `jsonSchema` field is itself an open JSON Schema —
 * schema-*shaped*, not schema-*conforming* data. Exposing that to AI/MCP
 * generation would let a generator define an arbitrary field set, bypassing
 * the enumerable, reviewable kind catalog `ScopedRegistry`/`kinds.include`
 * exists to enforce — so this kind registers `hostAuthoredOnly: true` and
 * is meant to be hand-authored into a document, the same way a host
 * registers a `connection`, never listed in an AI-facing scope's
 * `kinds.include`.
 */
export function createRJSFPlugin(customValidators: Record<string, CustomValidator> = {}): ResourceKitPlugin<KindRenderFn> {
  return {
    name: 'rjsf-adapter',
    kinds: [
      {
        apiVersion: API_VERSION,
        kind: 'JSONSchemaForm',
        level: ['organism', 'template'],
        hostAuthoredOnly: true,
        description: 'A form rendered from a raw JSON Schema via react-jsonschema-form — for cross-field validation or dynamic array-of-objects fields a composed designkit form cannot express. Host-authored only: never exposed to AI/MCP generation scopes.',
        specSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['jsonSchema', 'submit'],
          properties: {
            jsonSchema: { type: 'object' },
            uiSchema: { type: 'object' },
            submit: { type: 'object' },
            submitLabel: { type: 'string' },
            customValidateKey: { type: 'string' },
          },
        },
        render: (resource: Resource, ctx: RenderContext) => (
          <JSONSchemaFormNode spec={resource.spec as JSONSchemaFormSpec} ctx={ctx} customValidators={customValidators} />
        ),
      },
    ],
  }
}
