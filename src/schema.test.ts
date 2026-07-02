import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry'
import { restResolver, staticResolver } from './resolvers'
import { buildDocumentSchema } from './schema'

describe('buildDocumentSchema', () => {
  it('builds a scoped recursive schema from registered manifests and resolvers', () => {
    const registry = createRegistry()
    registry.use({
      name: 'test',
      kinds: [
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Panel',
          specSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              pageSize: { type: 'number' },
              secret: { type: 'string' },
              data: { type: 'object' },
            },
          },
          slotPolicy: { defaultSlot: { min: 0, accepts: ['Text'] } },
        },
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Text',
          specSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
        {
          apiVersion: 'loykin.dev/v1alpha1',
          kind: 'Login',
          specSchema: { type: 'object' },
        },
      ],
      dataResolvers: { static: staticResolver, rest: restResolver },
    })

    const schema = buildDocumentSchema(
      registry.scope({
        kinds: { include: ['Panel', 'Text'] },
        spec: { Panel: { pick: ['title', 'data', 'pageSize'], lock: { pageSize: 50 } } },
      }),
    )

    expect(JSON.stringify(schema)).toContain('Panel')
    expect(JSON.stringify(schema)).toContain('Text')
    expect(JSON.stringify(schema)).not.toContain('Login')
    expect(JSON.stringify(schema)).toContain('"const":50')
    expect(JSON.stringify(schema)).toContain('#/$defs/dataBinding')
    expect(JSON.stringify(schema)).toContain('"const":"rest"')
    expect(JSON.stringify(schema)).toContain('"const":"static"')
  })
})
