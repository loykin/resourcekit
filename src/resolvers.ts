import type { DataResolver, RestBinding, StaticBinding } from './types'

/**
 * Built-in resolvers. Only `rest` and `static` live in core — the
 * `datasource` resolver ships as a datasourcekit adapter package, never here.
 */

export const staticResolver: DataResolver = async (binding) => {
  return (binding as StaticBinding).rows
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (typeof current !== 'object' || current === null) return undefined
    return (current as Record<string, unknown>)[part]
  }, value)
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
    throw new Error('REST resolver expected rows to be an array of objects')
  }
  return value as Record<string, unknown>[]
}

export const restResolver: DataResolver = async (binding, ctx) => {
  const b = binding as RestBinding
  const response = await fetch(b.url, {
    method: b.method ?? 'GET',
    headers: b.headers,
    body: b.body === undefined ? undefined : JSON.stringify(b.body),
    signal: ctx.signal,
  })

  if (!response.ok) {
    throw new Error(`REST resolver request failed: ${response.status} ${response.statusText}`)
  }

  const json: unknown = await response.json()
  if (b.rowsPath) return asRows(getPath(json, b.rowsPath))
  if (Array.isArray(json)) return asRows(json)
  return asRows(getPath(json, 'rows'))
}
